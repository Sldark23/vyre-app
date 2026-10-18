import { useRef, useState } from 'react';
import type { Attachment } from '@vyre/shared';
import { ApiError, uploadFile } from '../api';
import { PaperclipIcon, XIcon } from './Icons';

interface Pending extends Attachment {
  id: string;
  uploading: boolean;
}

/** Estado de anexos do composer: seleciona → upload → chips → envia */
export function useAttachments() {
  const [items, setItems] = useState<Pending[]>([]);

  async function addFiles(files: FileList | File[]) {
    const images = Array.from(files).filter((f) => f.type.startsWith('image/'));
    for (const file of images.slice(0, 4)) {
      const id = Math.random().toString(36).slice(2);
      setItems((prev) => [...prev, { id, url: '', name: file.name, uploading: true }]);
      try {
        const { url } = await uploadFile(file);
        setItems((prev) =>
          prev.map((i) => (i.id === id ? { ...i, url, uploading: false } : i)),
        );
      } catch (err) {
        setItems((prev) => prev.filter((i) => i.id !== id));
        alert(err instanceof ApiError ? err.message : 'Falha no upload da imagem');
      }
    }
  }

  function remove(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function clear() {
    setItems([]);
  }

  const ready: Attachment[] = items.filter((i) => !i.uploading && i.url).map(({ url, name }) => ({ url, name }));
  const busy = items.some((i) => i.uploading);

  return { items, addFiles, remove, clear, ready, busy };
}

/** Botão + (clip) com input de arquivo escondido */
export function AttachButton({ onFiles }: { onFiles: (files: FileList) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <button
      type="button"
      className="attach-btn"
      title="Anexar imagem (PNG, JPEG, GIF ou WebP — até 8MB)"
      onClick={() => ref.current?.click()}
    >
      <PaperclipIcon size={18} />
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </button>
  );
}

/** Chips de pré-visualização acima do composer */
export function AttachmentChips({
  items,
  onRemove,
}: {
  items: Pending[];
  onRemove: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="attach-chips">
      {items.map((i) => (
        <div key={i.id} className={`attach-chip ${i.uploading ? 'uploading' : ''}`}>
          {i.url ? <img src={i.url} alt={i.name} /> : <span className="spinner">…</span>}
          <span className="attach-name">{i.name}</span>
          <button type="button" onClick={() => onRemove(i.id)} title="Remover">
            <XIcon size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
