import { env } from '../env';

interface CdnFile {
  filename: string;
  url: string;
  size: number;
  mimetype: string;
  createdAt: string;
}

interface UploadResponse {
  success: boolean;
  filename?: string;
  url?: string;
  error?: string;
}

interface ChunkUploadResponse {
  success: boolean;
  uploadId?: string;
  error?: string;
}

interface FilesListResponse {
  success: boolean;
  files?: CdnFile[];
  error?: string;
}

class CdnClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = env.cdnBaseUrl.replace(/\/$/, '');
    this.apiKey = env.cdnApiKey;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      ...(options.headers as Record<string, string> || {}),
    };

    // Don't set Content-Type for FormData - let browser set it with boundary
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`CDN error ${response.status}: ${text}`);
    }

    return response.json();
  }

  /**
   * Check CDN health
   */
  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/`);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Upload a single file (multipart/form-data)
   */
  async uploadFile(file: Buffer, filename: string, mimetype: string): Promise<UploadResponse> {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(file)], { type: mimetype });
    formData.append('file', blob, filename);

    return this.request<UploadResponse>('/api/upload', {
      method: 'POST',
      body: formData,
    });
  }

  /**
   * Start a chunked upload - returns uploadId
   */
  async startChunkedUpload(
    filename: string,
    mimetype: string,
    totalSize: number,
    totalChunks: number
  ): Promise<ChunkUploadResponse> {
    // The CDN doesn't have a dedicated "start" endpoint, we just upload chunks
    // and use a generated uploadId. We'll use the first chunk upload to establish it.
    // For compatibility, we return a generated uploadId here.
    const uploadId = `vyre-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    return { success: true, uploadId };
  }

  /**
   * Upload a chunk
   */
  async uploadChunk(
    uploadId: string,
    chunk: Buffer,
    index: number,
    totalChunks: number,
    totalSize: number,
    mimetype: string
  ): Promise<ChunkUploadResponse> {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(chunk)], { type: mimetype });
    formData.append('chunk', blob, `chunk-${index}`);
    formData.append('index', index.toString());
    formData.append('totalChunks', totalChunks.toString());
    formData.append('totalSize', totalSize.toString());
    formData.append('mimetype', mimetype);

    return this.request<ChunkUploadResponse>(`/api/chunks/${uploadId}`, {
      method: 'POST',
      body: formData,
    });
  }

  /**
   * Complete a chunked upload
   */
  async completeChunkedUpload(
    uploadId: string,
    totalChunks: number,
    filename: string,
    mimetype: string
  ): Promise<UploadResponse> {
    return this.request<UploadResponse>(`/api/chunks/${uploadId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ totalChunks, filename, mimetype }),
    });
  }

  /**
   * List all files
   */
  async listFiles(): Promise<FilesListResponse> {
    return this.request<FilesListResponse>('/api/files', {
      method: 'GET',
    });
  }

  /**
   * Delete a file
   */
  async deleteFile(filename: string): Promise<{ success: boolean; error?: string }> {
    return this.request(`/api/files/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    });
  }

  /**
   * Get public URL for a file
   */
  getFileUrl(filename: string): string {
    return `${this.baseUrl}/files/${encodeURIComponent(filename)}`;
  }
}

export const cdn = new CdnClient();

/**
 * Helper: upload a file from a Fastify multipart stream
 */
export async function uploadToCdn(
  file: AsyncIterable<Buffer>,
  filename: string,
  mimetype: string,
  maxSize: number = 50 * 1024 * 1024 // 50MB default
): Promise<{ url: string; filename: string; size: number }> {
  const chunks: Buffer[] = [];
  let totalSize = 0;

  for await (const chunk of file) {
    totalSize += chunk.length;
    if (totalSize > maxSize) {
      throw new Error(`File too large (max ${maxSize} bytes)`);
    }
    chunks.push(chunk);
  }

  const buffer = Buffer.concat(chunks);
  const result = await cdn.uploadFile(buffer, filename, mimetype);

  if (!result.success || !result.url || !result.filename) {
    throw new Error(result.error || 'CDN upload failed');
  }

  return {
    url: result.url,
    filename: result.filename,
    size: totalSize,
  };
}

/**
 * Helper: upload a file via chunked upload (for large files)
 */
export async function uploadToCdnChunked(
  file: AsyncIterable<Buffer>,
  filename: string,
  mimetype: string,
  chunkSize: number = 5 * 1024 * 1024, // 5MB chunks
  maxSize: number = 200 * 1024 * 1024 // 200MB default
): Promise<{ url: string; filename: string; size: number }> {
  const uploadId = `vyre-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  let index = 0;
  let totalSize = 0;
  let chunkBuffer: Buffer[] = [];
  let chunkBufferSize = 0;

  for await (const chunk of file) {
    totalSize += chunk.length;
    if (totalSize > maxSize) {
      throw new Error(`File too large (max ${maxSize} bytes)`);
    }

    chunkBuffer.push(chunk);
    chunkBufferSize += chunk.length;

    // When chunk buffer reaches chunkSize, upload it
    while (chunkBufferSize >= chunkSize) {
      const combined = Buffer.concat(chunkBuffer);
      const toUpload = combined.subarray(0, chunkSize);
      chunkBuffer = [combined.subarray(chunkSize)];
      chunkBufferSize = chunkBuffer[0].length;

      const res = await cdn.uploadChunk(uploadId, toUpload, index, 0, totalSize, mimetype);
      if (!res.success) {
        throw new Error(res.error || `Chunk ${index} upload failed`);
      }
      index++;
    }
  }

  // Upload remaining chunks
  if (chunkBufferSize > 0) {
    const combined = Buffer.concat(chunkBuffer);
    const res = await cdn.uploadChunk(uploadId, combined, index, 0, totalSize, mimetype);
    if (!res.success) {
      throw new Error(res.error || `Chunk ${index} upload failed`);
    }
    index++;
  }

  // Complete the upload
  const res = await cdn.completeChunkedUpload(uploadId, index, filename, mimetype);
  if (!res.success || !res.url || !res.filename) {
    throw new Error(res.error || 'CDN complete failed');
  }

  return {
    url: res.url,
    filename: res.filename,
    size: totalSize,
  };
}