import { useEffect, useState } from 'react';
import type { Channel, ChannelType } from '@vyre/shared';
import { api, ApiError, uploadFile } from '../api';
import { useStore } from '../store';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CopyIcon,
  CrownIcon,
  PencilIcon,
  PlusIcon,
  ShieldIcon,
  TrashIcon,
  XIcon,
} from './Icons';

type Tab = 'geral' | 'canais' | 'convite' | 'membros' | 'perigo';

const TYPE_LABEL: Record<ChannelType, string> = {
  text: 'Texto',
  voice: 'Voz',
  announcement: 'Anúncios',
  forum: 'Fórum',
};

const SLOWMODES = [
  { v: 0, label: 'Desligado' },
  { v: 5, label: '5s' },
  { v: 10, label: '10s' },
  { v: 30, label: '30s' },
  { v: 60, label: '1 min' },
  { v: 300, label: '5 min' },
];

export default function ClusterSettingsModal() {
  const clusterId = useStore((s) => s.currentClusterId);
  const cluster = useStore((s) => s.clusters.find((c) => c.id === s.currentClusterId));
  const channels = useStore((s) =>
    s.currentClusterId ? s.channels[s.currentClusterId] : undefined,
  );
  const details = useStore((s) =>
    s.currentClusterId ? s.details[s.currentClusterId] : undefined,
  );
  const closeSettings = useStore((s) => s.closeSettings);
  const updateCluster = useStore((s) => s.updateCluster);
  const loadClusters = useStore((s) => s.loadClusters);
  const createChannel = useStore((s) => s.createChannel);
  const updateChannel = useStore((s) => s.updateChannel);
  const deleteChannel = useStore((s) => s.deleteChannel);
  const deleteCluster = useStore((s) => s.deleteCluster);
  const kickMember = useStore((s) => s.kickMember);
  const setMemberRole = useStore((s) => s.setMemberRole);

  const myRole = details?.myRole ?? null;
  const isOwner = myRole === 'owner';
  const canManage = isOwner || myRole === 'moderator';
  const meId = useStore((s) => s.user?.id);

  const [tab, setTab] = useState<Tab>(canManage ? 'geral' : 'convite');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // geral
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [color, setColor] = useState('#000000');
  const [iconUrl, setIconUrl] = useState<string | null>(null);

  // canais
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<ChannelType>('text');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edName, setEdName] = useState('');
  const [edTopic, setEdTopic] = useState('');
  const [edType, setEdType] = useState<ChannelType>('text');
  const [edSlow, setEdSlow] = useState(0);
  const [edLocked, setEdLocked] = useState(false);

  // convite
  const [copied, setCopied] = useState(false);

  // perigo
  const [confirmText, setConfirmText] = useState('');

  useEffect(() => {
    if (!cluster) return;
    setName(cluster.name);
    setDesc(cluster.description);
    setColor(cluster.bannerColor);
    setIconUrl(cluster.iconUrl);
    setErr('');
    setConfirmText('');
    setEditingId(null);
  }, [cluster?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeSettings();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closeSettings]);

  if (!cluster || !clusterId) return null;

  async function guard(fn: () => Promise<void>) {
    setErr('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Algo deu errado');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(ch: Channel) {
    setEditingId(ch.id);
    setEdName(ch.name);
    setEdTopic(ch.topic);
    setEdType(ch.type);
    setEdSlow(ch.slowmodeSeconds);
    setEdLocked(ch.locked);
  }

  const tabs = (
    [
      { key: 'geral', label: 'Geral' },
      { key: 'canais', label: 'Canais' },
      { key: 'convite', label: 'Convite' },
      { key: 'membros', label: 'Membros' },
      { key: 'perigo', label: 'Zona de perigo' },
    ] as { key: Tab; label: string }[]
  ).filter((t) => {
    if (t.key === 'geral' || t.key === 'perigo') return isOwner;
    if (t.key === 'canais' || t.key === 'membros') return canManage;
    return true; // convite: qualquer membro
  });

  const activeTab = tabs.some((t) => t.key === tab) ? tab : tabs[0]?.key ?? 'convite';

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && closeSettings()}>
      <div className="settings-modal">
        <nav className="settings-nav">
          <div className="settings-server">
            <div className="cluster-icon" style={{ background: cluster.bannerColor }}>
              {cluster.iconUrl ? (
                <img src={cluster.iconUrl} alt="" />
              ) : (
                cluster.name.slice(0, 1).toUpperCase()
              )}
            </div>
            <div>
              <div className="settings-server-name">{cluster.name}</div>
              <div className="settings-server-sub">
                {isOwner ? 'Dono' : myRole === 'moderator' ? 'Moderador' : 'Membro'}
              </div>
            </div>
          </div>
          <div className="settings-sep" />
          {tabs.map((t) => (
            <button
              key={t.key}
              className={`settings-tab ${activeTab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
          <div className="settings-sep" />
          <button className="settings-tab close-tab" onClick={closeSettings}>
            <XIcon size={14} /> Fechar
          </button>
        </nav>

        <section className="settings-body">
          {err && <div className="error-box">{err}</div>}

          {activeTab === 'geral' && isOwner && (
            <div className="settings-form">
              <h2>Visão geral do cluster</h2>
              <label>Ícone do cluster</label>
              <div className="icon-upload">
                <div className="cluster-icon lg" style={{ background: color }}>
                  {iconUrl ? <img src={iconUrl} alt="" /> : name.slice(0, 1).toUpperCase() || '?'}
                </div>
                <div className="icon-upload-actions">
                  <label className="btn-ghost file-label">
                    Enviar imagem
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      hidden
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (!f) return;
                        await guard(async () => {
                          const { url } = await uploadFile(f);
                          await updateCluster(clusterId, { iconUrl: url });
                          setIconUrl(url);
                        });
                      }}
                    />
                  </label>
                  {iconUrl && (
                    <button
                      className="btn-ghost danger"
                      onClick={() =>
                        void guard(async () => {
                          await updateCluster(clusterId, { iconUrl: null });
                          setIconUrl(null);
                        })
                      }
                    >
                      Remover
                    </button>
                  )}
                </div>
              </div>

              <label>Nome</label>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
              <label>Descrição</label>
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="Sobre o que é este cluster?"
              />
              <label>Cor do banner</label>
              <div className="color-row">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                />
                <span>{color}</span>
              </div>
              <button
                className="btn-solid"
                disabled={busy || !name.trim()}
                onClick={() =>
                  void guard(async () => {
                    await updateCluster(clusterId, {
                      name: name.trim(),
                      description: desc,
                      bannerColor: color,
                    });
                  })
                }
              >
                Salvar alterações
              </button>
            </div>
          )}

          {activeTab === 'canais' && canManage && (
            <div className="settings-form">
              <h2>Canais</h2>

              <form
                className="channel-create"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newName.trim()) return;
                  void guard(async () => {
                    await createChannel(clusterId, newName.trim(), newType);
                    setNewName('');
                    setNewType('text');
                  });
                }}
              >
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="nome-do-canal"
                  maxLength={100}
                />
                <select value={newType} onChange={(e) => setNewType(e.target.value as ChannelType)}>
                  {(Object.keys(TYPE_LABEL) as ChannelType[]).map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
                <button className="btn-solid" disabled={busy || !newName.trim()}>
                  <PlusIcon size={14} /> Criar
                </button>
              </form>

              <div className="channel-manage-list">
                {(channels ?? []).map((ch, i) => (
                  <div key={ch.id} className="channel-manage">
                    {editingId === ch.id ? (
                      <div className="channel-edit">
                        <div className="row">
                          <input
                            value={edName}
                            onChange={(e) => setEdName(e.target.value)}
                            maxLength={100}
                          />
                          <select
                            value={edType}
                            onChange={(e) => setEdType(e.target.value as ChannelType)}
                          >
                            {(Object.keys(TYPE_LABEL) as ChannelType[]).map((t) => (
                              <option key={t} value={t}>
                                {TYPE_LABEL[t]}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="row">
                          <input
                            value={edTopic}
                            onChange={(e) => setEdTopic(e.target.value)}
                            placeholder="tópico (opcional)"
                            maxLength={500}
                          />
                        </div>
                        <div className="row">
                          <label>
                            Slowmode{' '}
                            <select
                              value={edSlow}
                              onChange={(e) => setEdSlow(Number(e.target.value))}
                            >
                              {SLOWMODES.map((s) => (
                                <option key={s.v} value={s.v}>
                                  {s.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={edLocked}
                              onChange={(e) => setEdLocked(e.target.checked)}
                            />
                            Travado (ninguém posta)
                          </label>
                        </div>
                        <div className="row actions">
                          <button
                            className="btn-solid"
                            disabled={busy || !edName.trim()}
                            onClick={() =>
                              void guard(async () => {
                                await updateChannel(clusterId, ch.id, {
                                  name: edName.trim(),
                                  topic: edTopic,
                                  type: edType,
                                  slowmodeSeconds: edSlow,
                                  locked: edLocked,
                                });
                                setEditingId(null);
                              })
                            }
                          >
                            Salvar
                          </button>
                          <button className="btn-ghost" onClick={() => setEditingId(null)}>
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="channel-manage-main">
                          <span className="ch-type">{TYPE_LABEL[ch.type]}</span>
                          <span className="ch-name">{ch.name}</span>
                          {ch.locked && <span className="tag-pill">travado</span>}
                          {ch.slowmodeSeconds > 0 && (
                            <span className="tag-pill">slow {ch.slowmodeSeconds}s</span>
                          )}
                        </div>
                        <div className="channel-manage-actions">
                          <button
                            title="Mover pra cima"
                            disabled={i === 0 || busy}
                            onClick={() =>
                              void guard(() => updateChannel(clusterId, ch.id, { move: 'up' }))
                            }
                          >
                            <ArrowUpIcon size={14} />
                          </button>
                          <button
                            title="Mover pra baixo"
                            disabled={i === (channels?.length ?? 0) - 1 || busy}
                            onClick={() =>
                              void guard(() => updateChannel(clusterId, ch.id, { move: 'down' }))
                            }
                          >
                            <ArrowDownIcon size={14} />
                          </button>
                          <button title="Editar" onClick={() => startEdit(ch)}>
                            <PencilIcon size={14} />
                          </button>
                          <button
                            className="danger"
                            title="Apagar canal"
                            disabled={busy}
                            onClick={() => {
                              if (
                                confirm(`Apagar o canal #${ch.name}? As mensagens vão junto.`)
                              ) {
                                void guard(() => deleteChannel(clusterId, ch.id));
                              }
                            }}
                          >
                            <TrashIcon size={14} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'convite' && (
            <div className="settings-form">
              <h2>Convite do cluster</h2>
              <p className="hint">
                Compartilhe esse código — o outro membro usa ele em “Entrar com convite” no rail.
              </p>
              <div className="invite-row">
                <code className="invite-code">{cluster.inviteCode}</code>
                <button
                  className="btn-solid"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(cluster.inviteCode)
                      .then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      })
                      .catch(() => setErr('Não deu pra copiar — copie manualmente'));
                  }}
                >
                  <CopyIcon size={14} /> {copied ? 'Copiado!' : 'Copiar'}
                </button>
              </div>
              {isOwner && (
                <button
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() =>
                    void guard(async () => {
                      await api.post(`/api/v1/clusters/${clusterId}/invite`);
                      await loadClusters();
                    })
                  }
                >
                  Regenerar código (invalida o antigo)
                </button>
              )}
            </div>
          )}

          {activeTab === 'membros' && canManage && (
            <div className="settings-form">
              <h2>Membros — {details?.members.length ?? 0}</h2>
              <div className="member-manage-list">
                {(details?.members ?? []).map((m) => {
                  const cantTouch =
                    m.role === 'owner' ||
                    m.user.id === meId ||
                    (myRole === 'moderator' && m.role === 'moderator');
                  return (
                    <div key={m.user.id} className="member-manage">
                      <div className="avatar sm" style={{ background: m.user.bannerColor }}>
                        {m.user.avatarUrl ? (
                          <img src={m.user.avatarUrl} alt="" />
                        ) : (
                          m.user.displayName.slice(0, 1).toUpperCase()
                        )}
                      </div>
                      <div className="member-manage-info">
                        <span className="mm-name">{m.nickname || m.user.displayName}</span>
                        <span className="mm-user">@{m.user.username}</span>
                      </div>
                      {m.role === 'owner' ? (
                        <span className="role-tag owner">
                          <CrownIcon size={13} /> Dono
                        </span>
                      ) : isOwner ? (
                        <select
                          className="role-select"
                          value={m.role}
                          disabled={busy}
                          onChange={(e) =>
                            void guard(() =>
                              setMemberRole(
                                clusterId,
                                m.user.id,
                                e.target.value as 'moderator' | 'member',
                              ),
                            )
                          }
                        >
                          <option value="member">Membro</option>
                          <option value="moderator">Moderador</option>
                        </select>
                      ) : (
                        <span className="role-tag">
                          {m.role === 'moderator' ? (
                            <>
                              <ShieldIcon size={13} /> Mod
                            </>
                          ) : (
                            'Membro'
                          )}
                        </span>
                      )}
                      {!cantTouch && (
                        <button
                          className="member-kick"
                          title={`Kickar @${m.user.username}`}
                          onClick={() => {
                            if (confirm(`Kickar @${m.user.username} do cluster?`)) {
                              void guard(() => kickMember(clusterId, m.user.id));
                            }
                          }}
                        >
                          <TrashIcon size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'perigo' && isOwner && (
            <div className="settings-form">
              <h2>Zona de perigo</h2>
              <div className="danger-zone">
                <div>
                  <b>Apagar o cluster</b>
                  <p>
                    Apaga {cluster.name} pra todo mundo: canais, mensagens e membros. Não tem
                    volta.
                  </p>
                </div>
                <div className="danger-confirm">
                  <input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={`digite ${cluster.name} pra confirmar`}
                  />
                  <button
                    className="btn-danger"
                    disabled={busy || confirmText !== cluster.name}
                    onClick={() => void guard(() => deleteCluster(clusterId))}
                  >
                    Apagar cluster
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
