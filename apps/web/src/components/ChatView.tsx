import { useEffect, useMemo, useRef, useState } from 'react';
import type { Message } from '@vyre/shared';
import { api, ApiError } from '../api';
import { sendTyping } from '../ws';
import { useStore } from '../store';

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <div className="avatar" style={{ background: color }}>
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function MessageRow({
  message,
  grouped,
  replyAuthor,
  onReply,
}: {
  message: Message;
  grouped: boolean;
  replyAuthor?: string;
  onReply: (m: Message) => void;
}) {
  const user = useStore((s) => s.user);
  const editMessage = useStore((s) => s.editMessage);
  const deleteMessage = useStore((s) => s.deleteMessage);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const isAuthor = user?.id === message.author.id;

  async function saveEdit() {
    setEditing(false);
    const content = draft.trim();
    if (!content || content === message.content) return;
    try {
      await editMessage(message.id, content);
    } catch (err) {
      if (err instanceof ApiError) alert(err.message);
    }
  }

  return (
    <div className={`message ${grouped ? 'grouped' : ''}`}>
      <div className="gutter">
        {!grouped && <Avatar name={message.author.displayName} color={message.author.bannerColor} />}
      </div>
      <div className="body">
        {message.replyTo && replyAuthor && (
          <div className="reply-ref">↩︎ respondendo <b>{replyAuthor}</b></div>
        )}
        {!grouped && (
          <div className="meta">
            <span className="author" style={{ color: message.author.bannerColor }}>
              {message.author.displayName}
            </span>
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
          <button
            className="danger"
            onClick={() => deleteMessage(message.id).catch(() => {})}
          >
            Apagar
          </button>
        </div>
      )}
      {!isAuthor && !editing && (
        <div className="actions">
          <button onClick={() => onReply(message)}>Responder</button>
        </div>
      )}
    </div>
  );
}

export default function ChatView() {
  const currentChannelId = useStore((s) => s.currentChannelId);
  const channels = useStore((s) => s.channels);
  const messages = useStore((s) => (currentChannelId ? s.messages[currentChannelId] : undefined));
  const sendMessage = useStore((s) => s.sendMessage);
  const [draft, setDraft] = useState('');
  const [reply, setReply] = useState<Message | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHits, setSearchHits] = useState<Message[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef(0);

  const channel = useMemo(() => {
    for (const list of Object.values(channels)) {
      const found = list.find((c) => c.id === currentChannelId);
      if (found) return found;
    }
    return undefined;
  }, [channels, currentChannelId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages?.length]);

  useEffect(() => {
    setSearchOpen(false);
    setSearchHits(null);
    setSearchQuery('');
  }, [currentChannelId]);

  const messageById = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of messages ?? []) map.set(m.id, m);
    return map;
  }, [messages]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!draft.trim() || !currentChannelId) return;
    const content = draft.trim();
    setDraft('');
    const replyTo = reply?.id;
    setReply(null);
    try {
      await sendMessage(currentChannelId, content, replyTo);
    } catch (err) {
      if (err instanceof ApiError) {
        alert(err.message);
        setDraft(content);
      }
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    const now = Date.now();
    if (currentChannelId && now - typingTimer.current > 4000) {
      typingTimer.current = now;
      sendTyping(currentChannelId);
    }
  }

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!currentChannelId || !searchQuery.trim()) return;
    setSearchError(null);
    try {
      const data = await api.get<{ messages: Message[] }>(
        `/api/v1/channels/${currentChannelId}/search?q=${encodeURIComponent(searchQuery.trim())}`,
      );
      setSearchHits(data.messages);
    } catch (err) {
      setSearchError(err instanceof ApiError ? err.message : 'Falha na busca');
    }
  }

  let lastDay = '';
  let lastAuthor = '';

  return (
    <main className="chat">
      <div className="chat-header">
        <span className="title"># {channel?.name ?? '…'}</span>
        {channel?.topic && <span className="topic">{channel.topic}</span>}
        <button className="search-btn" onClick={() => setSearchOpen((v) => !v)}>
          🔍 Buscar <span style={{ opacity: 0.6 }}>de: fulano antes: 2026-01-01</span>
        </button>
      </div>

      {searchOpen && (
        <form
          onSubmit={runSearch}
          style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}
        >
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="buscar mensagens… filtros: de:usuario antes:2026-01-01 depois:2025-12-31"
            style={{
              flex: 1,
              background: 'var(--bg-0)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '8px 12px',
              color: 'var(--text-0)',
              outline: 'none',
            }}
            autoFocus
          />
          <button className="btn-solid">Buscar</button>
        </form>
      )}

      {searchHits !== null ? (
        <div className="search-results">
          {searchError && <div className="error-box">{searchError}</div>}
          {searchHits.length === 0 && (
            <div style={{ color: 'var(--text-2)', padding: 12 }}>Nada encontrado.</div>
          )}
          {searchHits.map((m) => (
            <div key={m.id} className="search-hit">
              <span className="who" style={{ color: m.author.bannerColor }}>
                {m.author.displayName}
              </span>
              <span className="when">{new Date(m.createdAt).toLocaleString('pt-BR')}</span>
              <div style={{ marginTop: 4, color: 'var(--text-1)' }}>{m.content}</div>
            </div>
          ))}
          <button className="btn-ghost" onClick={() => setSearchHits(null)}>
            ← Voltar pro canal
          </button>
        </div>
      ) : (
        <>
          <div className="message-list">
            {!channel && (
              <div className="empty-state">
                <div className="big">💬</div>
                <h2>Bem-vindo ao Vyre</h2>
                <p>Selecione ou crie um cluster pra começar a conversar</p>
              </div>
            )}
            {channel && (messages?.length ?? 0) === 0 && (
              <div className="empty-state">
                <div className="big">🎉</div>
                <h2>#{channel.name}</h2>
                <p>Este é o começo do canal. Manda a primeira mensagem!</p>
              </div>
            )}
            {(messages ?? []).map((m) => {
              const day = new Date(m.createdAt).toDateString();
              const showDay = day !== lastDay;
              lastDay = day;
              const grouped = !showDay && m.author.id === lastAuthor;
              lastAuthor = m.author.id;
              const replyAuthor = m.replyTo ? messageById.get(m.replyTo)?.author.displayName : undefined;
              return (
                <div key={m.id} style={{ width: '100%' }}>
                  {showDay && <div className="day-sep">{formatDate(m.createdAt)}</div>}
                  <MessageRow message={m} grouped={grouped} replyAuthor={replyAuthor} onReply={setReply} />
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          <div className="composer-wrap">
            {reply && (
              <div className="reply-bar">
                <span>
                  Respondendo <b>{reply.author.displayName}</b>
                </span>
                <button onClick={() => setReply(null)}>✕</button>
              </div>
            )}
            <form className={`composer ${reply ? 'with-reply' : ''}`} onSubmit={submit}>
              <textarea
                rows={1}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
                }}
                onKeyDown={onKeyDown}
                placeholder={channel ? `Msg em #${channel.name}` : 'Selecione um canal'}
                disabled={!channel}
                maxLength={4000}
              />
              <button className="send" type="submit" disabled={!draft.trim()}>
                ➤
              </button>
            </form>
          </div>
        </>
      )}
    </main>
  );
}
