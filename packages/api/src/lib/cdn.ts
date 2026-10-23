import { env } from '../env';
import crypto from 'node:crypto';

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
  receivedChunk?: number;
  totalChunks?: number;
}

interface CdnFileRaw {
  filename: string;
  size: number;
  url: string;
}

interface FilesListResponse {
  success?: boolean;
  count?: number;
  files?: CdnFileRaw[];
  error?: string;
}

class CdnClient {
  private baseUrl: string;
  private apiKey: string;
  private chunkSize: number = 5 * 1024 * 1024; // 5MB

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

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/`);
      return res.ok;
    } catch {
      return false;
    }
  }

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
   * Generate a valid uploadId (UUID v4) for chunked uploads
   */
  private generateUploadId(): string {
    return crypto.randomUUID();
  }

  /**
   * Calculate totalChunks for a given file size
   */
  private calculateTotalChunks(totalSize: number): number {
    return Math.ceil(totalSize / this.chunkSize);
  }

  /**
   * Start a chunked upload - generates a valid UUID uploadId
   */
  async startChunkedUpload(
    filename: string,
    mimetype: string,
    totalSize: number
  ): Promise<ChunkUploadResponse> {
    const uploadId = this.generateUploadId();
    const totalChunks = this.calculateTotalChunks(totalSize);
    return { success: true, uploadId, totalChunks };
  }

  /**
   * Upload a chunk to CDN
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

  async listFiles(): Promise<{ success: boolean; files?: CdnFile[]; error?: string }> {
    const res = await this.request<FilesListResponse>('/api/files', {
      method: 'GET',
    });
    // Transform CDN response format to internal format
    if (res.files) {
      const files: CdnFile[] = res.files.map(f => ({
        filename: f.filename,
        url: f.url,
        size: f.size,
        mimetype: f.filename.endsWith('.mp4') || f.filename.endsWith('.webm') || f.filename.endsWith('.mov') 
          ? 'video/mp4' : 'image/jpeg',
        createdAt: new Date().toISOString(),
      }));
      return { success: true, files };
    }
    return { success: false, error: res.error || 'Unknown error' };
  }

  async deleteFile(filename: string): Promise<{ success: boolean; error?: string }> {
    return this.request(`/api/files/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    });
  }

  getFileUrl(filename: string): string {
    return `${this.baseUrl}/files/${encodeURIComponent(filename)}`;
  }
}

export const cdn = new CdnClient();

/**
 * Helper: upload a file from a Fastify multipart stream (normal upload)
 */
export async function uploadToCdn(
  file: AsyncIterable<Buffer>,
  filename: string,
  mimetype: string,
  maxSize: number = 50 * 1024 * 1024
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
 * Helper: upload a file via chunked upload (for large files/videos)
 * Returns uploadId for client to continue uploading chunks
 */
export async function startCdnChunkedUpload(
  filename: string,
  mimetype: string,
  totalSize: number
): Promise<{ uploadId: string; chunkSize: number; totalChunks: number }> {
  const res = await cdn.startChunkedUpload(filename, mimetype, totalSize);
  if (!res.success || !res.uploadId) {
    throw new Error(res.error || 'Failed to start chunked upload');
  }
  return {
    uploadId: res.uploadId,
    chunkSize: cdn['chunkSize'],
    totalChunks: res.totalChunks || Math.ceil(totalSize / (5 * 1024 * 1024)),
  };
}

/**
 * Upload a single chunk to an existing chunked upload
 */
export async function uploadCdnChunk(
  uploadId: string,
  chunk: Buffer,
  index: number,
  totalChunks: number,
  totalSize: number,
  mimetype: string
): Promise<{ success: boolean; error?: string }> {
  const res = await cdn.uploadChunk(uploadId, chunk, index, totalChunks, totalSize, mimetype);
  return { success: res.success, error: res.error };
}

/**
 * Complete a chunked upload
 */
export async function completeCdnChunkedUpload(
  uploadId: string,
  totalChunks: number,
  filename: string,
  mimetype: string
): Promise<{ url: string; filename: string; size: number }> {
  const res = await cdn.completeChunkedUpload(uploadId, totalChunks, filename, mimetype);
  if (!res.success || !res.url || !res.filename) {
    throw new Error(res.error || 'CDN complete failed');
  }
  return {
    url: res.url,
    filename: res.filename,
    size: 0, // CDN doesn't return size on complete
  };
}