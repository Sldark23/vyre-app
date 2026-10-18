import { useState } from 'react';
import type { Message } from '@vyre/shared';
import { ApiError } from '../api';
import { useStore } from '../store';

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

export function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <div className="avatar" style={{ background: color }}>
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

export default function MessageRow({
  message,
  grouped,
  replyAuthor,
  onReply,
  onEdit,
  onDelete,
}: {
  message: Message;
  grouped: boolean;
  replyAuthor?: string;
  onReply?: (m: Message) => void;
  onEdit: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const user = useStore((s) => s.user);
  const openProfile = useStore((s) => s.openProfile);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const isAuthor = user?.id === message.author.id;

  async function saveEdit() {
    setEditing(false);
    const content = draft.trim();
    if (!content || content === message.content) return;
    try {
      await onEdit(message.id, content);
    } catch (err) {
      if (err instanceof ApiError) alert(err.message);
    }
  }

  return (
    <div className={`message ${grouped ? 'grouped' : ''}`}>
      <div className="gutter">
        {!grouped && (
          <button
            className="avatar-btn"
            title={`Ver perfil de ${message.author.displayName}`}
            onClick={() => openProfile(message.author.username)}
          >
            <Avatar name={message.author.displayName} color={message.author.bannerColor} />
          </button>
        )}
      </div>
      <div className="body">
        {message.replyTo && replyAuthor && (
          <div className="reply-ref">↩︎ respondendo <b>{replyAuthor}</b></div>
        )}
        {!grouped && (
          <div className="meta">
            <button
              className="author"
              style={{ color: message.author.bannerColor }}
              onClick={() => openProfile(message.author.username)}
            >
              {message.author.displayName}
            </button>
            <span className="time">{formatTime(message.createdAt)}</span>
          </div>
        )}
        {editing ? (
          <textarea
            className="content"
            style={{
              width: '100%',
              background: 'var(--bg-0)',
              border: '1px solid var(--accent)',
              borderRadius: 6,
              color: 'var(--text-0)',
              padding: 6,
              outline: 'none',
            }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={saveEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                saveEdit();
              }
              if (e.key === 'Escape') {
                setDraft(message.content);
                setEditing(false);
              }
            }}
            autoFocus
          />
        ) : (
          <div className="content">
            {message.content}
            {message.editedAt && <span className="edited">(editado)</span>}
          </div>
        )}
      </div>
      {isAuthor && !editing && (
        <div className="actions">
          <button
            onClick={() => {
              setDraft(message.content);
              setEditing(true);
            }}
          >
            Editar
          </button>
          <button className="danger" onClick={() => onDelete(message.id).catch(() => {})}>
            Apagar
          </button>
        </div>
      )}
      {!isAuthor && !editing && onReply && (
        <div className="actions">
          <button onClick={() => onReply(message)}>Responder</button>
        </div>
      )}
    </div>
  );
}
