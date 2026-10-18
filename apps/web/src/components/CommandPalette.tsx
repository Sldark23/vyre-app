import { useEffect, useMemo, useState } from 'react';
import type { Channel } from '@vyre/shared';
import { useStore } from '../store';

interface JumpTarget {
  channel: Channel;
  clusterName: string;
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const clusters = useStore((s) => s.clusters);
  const channels = useStore((s) => s.channels);
  const selectCluster = useStore((s) => s.selectCluster);
  const selectChannel = useStore((s) => s.selectChannel);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery('');
        setSelected(0);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const targets = useMemo<JumpTarget[]>(() => {
    const all: JumpTarget[] = [];
    for (const cluster of clusters) {
      for (const ch of channels[cluster.id] ?? []) {
        all.push({ channel: ch, clusterName: cluster.name });
      }
    }
    const q = query.toLowerCase().trim();
    if (!q) return all.slice(0, 20);
    return all
      .filter((t) => t.channel.name.toLowerCase().includes(q) || t.clusterName.toLowerCase().includes(q))
      .slice(0, 20);
  }, [clusters, channels, query]);

  async function jump(target: JumpTarget) {
    setOpen(false);
    const cluster = clusters.find((c) => c.name === target.clusterName);
    if (cluster && cluster.id !== useStore.getState().currentClusterId) {
      await selectCluster(cluster.id);
    }
    selectChannel(target.channel.id);
  }

  if (!open) return null;

  return (
    <div className="palette-overlay" onClick={() => setOpen(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          placeholder="Pular pra um canal… (Ctrl+K)"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSelected((s) => Math.min(s + 1, targets.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSelected((s) => Math.max(s - 1, 0));
            } else if (e.key === 'Enter' && targets[selected]) {
              jump(targets[selected]);
            }
          }}
        />
        <div className="results">
          {targets.map((t, i) => (
            <button
              key={t.channel.id}
              className={`result ${i === selected ? 'selected' : ''}`}
              onClick={() => jump(t)}
            >
              <span>#</span>
              <span>{t.channel.name}</span>
              <span className="cluster-name">{t.clusterName}</span>
            </button>
          ))}
          {targets.length === 0 && (
            <div style={{ padding: 12, color: 'var(--text-2)', fontSize: 13 }}>Nada encontrado.</div>
          )}
        </div>
      </div>
    </div>
  );
}
