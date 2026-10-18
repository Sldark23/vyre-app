import { useState } from 'react';
import type { ChannelType } from '@vyre/shared';
import { useStore } from '../store';
import UserPanel from './UserPanel';
import VoicePanel from './VoicePanel';
import { joinVoice } from '../voice';
import {
  CopyIcon,
  ForumIcon,
  GearIcon,
  HashIcon,
  LockIcon,
  MegaphoneIcon,
  SpeakerIcon,
} from './Icons';

function ChannelTypeIcon({ type }: { type: ChannelType }) {
  if (type === 'voice') return <SpeakerIcon size={16} />;
  if (type === 'announcement') return <MegaphoneIcon size={16} />;
  if (type === 'forum') return <ForumIcon size={16} />;
  return <HashIcon size={16} />;
}

export default function ChannelSidebar() {
  const currentClusterId = useStore((s) => s.currentClusterId);
  const clusters = useStore((s) => s.clusters);
  const channels = useStore((s) => (currentClusterId ? s.channels[currentClusterId] : undefined));
  const details = useStore((s) => (currentClusterId ? s.details[currentClusterId] : undefined));
  const currentChannelId = useStore((s) => s.currentChannelId);
  const selectChannel = useStore((s) => s.selectChannel);
  const unread = useStore((s) => s.unread);
  const voiceParticipants = useStore((s) => s.voiceParticipants);
  const activeVoice = useStore((s) => s.activeVoice);
  const voiceLoading = useStore((s) => s.voiceLoading);
  const openSettings = useStore((s) => s.openSettings);
  const [copied, setCopied] = useState(false);

  const cluster = clusters.find((c) => c.id === currentClusterId);
  const textChannels = (channels ?? []).filter((c) => c.type !== 'voice');
  const voiceChannels = (channels ?? []).filter((c) => c.type === 'voice');
  const myRole = details?.myRole ?? null;
  const canManage = myRole === 'owner' || myRole === 'moderator';

  function copyInvite() {
    if (!cluster) return;
    void navigator.clipboard
      .writeText(cluster.inviteCode)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header" title={cluster?.description || cluster?.name}>
        <span className="sidebar-header-name">{cluster?.name ?? 'Vyre'}</span>
        {cluster && (
          <span className="sidebar-header-actions">
            <button
              className="header-icon-btn"
              title={copied ? 'Convite copiado!' : 'Copiar código de convite'}
              onClick={copyInvite}
            >
              <CopyIcon size={15} />
            </button>
            {canManage && (
              <button
                className="header-icon-btn"
                title="Configurações do cluster"
                onClick={openSettings}
              >
                <GearIcon size={15} />
              </button>
            )}
          </span>
        )}
      </div>
      <div className="channel-list">
        {!cluster && (
          <div style={{ padding: 12, color: 'var(--text-2)', fontSize: 13 }}>
            Crie um cluster no rail ao lado ou entre com um convite.
          </div>
        )}
        {textChannels.length > 0 && <div className="channel-category">Canais de texto</div>}
        {textChannels.map((ch) => (
          <button
            key={ch.id}
            className={`channel-item ${currentChannelId === ch.id ? 'active' : ''}`}
            onClick={() => selectChannel(ch.id)}
          >
            <span className="hash">
              <ChannelTypeIcon type={ch.type} />
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{ch.name}</span>
            {ch.locked && (
              <span className="ch-lock" title="Canal travado">
                <LockIcon size={13} />
              </span>
            )}
            {(unread[ch.id] ?? 0) > 0 && currentChannelId !== ch.id && (
              <span className="badge">{unread[ch.id]}</span>
            )}
          </button>
        ))}
        {voiceChannels.length > 0 && <div className="channel-category">Canais de voz</div>}
        {voiceChannels.map((ch) => {
          const inThis = activeVoice?.channelId === ch.id;
          const people = voiceParticipants[ch.id] ?? [];
          return (
            <div key={ch.id} className="voice-channel-block">
              <button
                className={`channel-item ${inThis ? 'active voice-active' : ''}`}
                disabled={voiceLoading && !inThis}
                onClick={() => {
                  if (inThis) return; // já está aqui
                  void joinVoice(ch.id, ch.clusterId).catch(() => {});
                }}
                title={inThis ? 'Você está conectado' : 'Entrar no canal de voz'}
              >
                <span className="hash">
                  <SpeakerIcon size={16} />
                </span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{ch.name}</span>
                {people.length > 0 && <span className="voice-count">{people.length}</span>}
              </button>
              {people.length > 0 && (
                <div className="voice-channel-people">
                  {people.map((p) => (
                    <div key={p.userId} className="voice-channel-person">
                      <div className="avatar xs" style={{ background: 'var(--bg-3)' }}>
                        {p.avatarUrl ? (
                          <img src={p.avatarUrl} alt="" />
                        ) : (
                          p.displayName.slice(0, 1).toUpperCase()
                        )}
                      </div>
                      <span>{p.displayName}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <VoicePanel />
      <UserPanel />
    </aside>
  );
}
