import { useEffect, useMemo, useRef, useState } from 'react';
import type { Message, PublicUser } from '@vyre/shared';
import { ApiError } from '../api';
import { sendDmTyping } from '../ws';
import { useStore } from '../store';
import MessageRow, { formatDate } from './MessageRow';
import { AttachButton, AttachmentChips, useAttachments } from './Attachments';
import { ChatIcon, SendIcon, XIcon } from './Icons';

function dmTitle(convId: string, meId: string | undefined): { title: string; other: PublicUser | undefined } {
  const conv = useStore.getState().dms.find((c) => c.id === convId);
  if (!conv) return { title: 'Conversa', other: undefined };
  if (conv.isGroup) return { title: conv.name ?? 'Grupo', other: undefined };
  const other = conv.participants.find((p) => p.id !== meId);
  return { title: other?.displayName ?? 'Conversa', other };
}

export default function DMView() {
  const currentDmId = useStore((s) => s.currentDmId);
  const me = useStore((s) => s.user);
  const conv = useStore((s) => s.dms.find((c) => c.id === s.currentDmId));
  const messages = useStore((s) => (currentDmId ? s.dmMessages[currentDmId] : undefined));
  const typingUserIds = useStore((s) => (currentDmId ? s.dmTyping[currentDmId] ?? [] : []));
  const sendDmMessage = useStore((s) => s.sendDmMessage);
  const editDmMessage = useStore((s) => s.editDmMessage);
  const deleteDmMessage = useStore((s) => s.deleteDmMessage);
  const openProfile = useStore((s) => s.openProfile);
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef(0);
  const att = useAttachments();

  const info = useMemo(
    () => (currentDmId ? dmTitle(currentDmId, me?.id) : { title: '', other: undefined }),
    [currentDmId, me?.id, conv],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages?.length]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!currentDmId) return;
    const content = draft.trim();
    const attachments = att.ready;
    if (!content && attachments.length === 0) return;
    try {
      await sendDmMessage(currentDmId, content, attachments);
      setDraft('');
      att.clear();
    } catch (err) {
      if (err instanceof ApiError) alert(err.message);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    const now = Date.now();
    if (currentDmId && now - typingTimer.current > 4000) {
      typingTimer.current = now;
      sendDmTyping(currentDmId);
    }
  }

  if (!currentDmId || !conv) {
    return (
      <main className="chat">
        <div className="chat-header">
          <span className="title">
            <ChatIcon size={17} /> Mensagens diretas
          </span>
        </div>
        <div className="empty-state">
          <div className="big">
            <ChatIcon size={40} />
          </div>
          <h2>Escolha uma conversa</h2>
          <p>Selecione um amigo pra conversar ou inicie uma nova mensagem.</p>
        </div>
      </main>
    );
  }

  const typingNames = typingUserIds
    .map((id) => conv.participants.find((p) => p.id === id)?.displayName)
    .filter(Boolean) as string[];

  let lastDay = '';
  let lastAuthor = '';

  return (
    <main className="chat">
      <div className="chat-header">
        <button className="dm-title" onClick={() => info.other && openProfile(info.other.username)}>
          {info.other && (
            <span className={`dot inline ${info.other.status}`} />
          )}
          <span className="title">@ {info.title}</span>
        </button>
        {conv.isGroup && (
          <span className="topic">{conv.participants.length} participantes</span>
        )}
        {!conv.isGroup && info.other?.customStatus && (
          <span className="topic">{info.other.customStatus}</span>
        )}
      </div>

      <div className="message-list">
        {(messages?.length ?? 0) === 0 && (
          <div className="empty-state">
            <div className="big">
              {info.other ? info.other.displayName.slice(0, 1) : <ChatIcon size={40} />}
            </div>
            <h2>{info.other ? `@${info.other.username}` : info.title}</h2>
            <p>Este é o começo da conversa. Manda a primeira mensagem!</p>
          </div>
        )}
        {(messages ?? []).map((m: Message) => {
          const day = new Date(m.createdAt).toDateString();
          const showDay = day !== lastDay;
          lastDay = day;
          const grouped = !showDay && m.author.id === lastAuthor;
          lastAuthor = m.author.id;
          return (
            <div key={m.id} style={{ width: '100%' }}>
              {showDay && <div className="day-sep">{formatDate(m.createdAt)}</div>}
              <MessageRow
                message={m}
                grouped={grouped}
                onEdit={editDmMessage}
                onDelete={deleteDmMessage}
              />
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="composer-wrap">
        {typingNames.length > 0 && (
          <div className="typing-ind">
            {typingNames.join(', ')} {typingNames.length > 1 ? ' estão' : ' está'} digitando…
          </div>
        )}
        <AttachmentChips items={att.items} onRemove={att.remove} />
        <form className={`composer ${att.items.length ? 'with-reply' : ''}`} onSubmit={submit}>
          <AttachButton onFiles={att.addFiles} />
          <textarea
            rows={1}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
            }}
            onKeyDown={onKeyDown}
            placeholder={`Mensagem para @${info.other?.username ?? info.title}`}
            maxLength={4000}
          />
          <button
            className="send"
            type="submit"
            disabled={att.busy || (!draft.trim() && att.ready.length === 0)}
          >
            <SendIcon size={18} />
          </button>
        </form>
      </div>
    </main>
  );
}
