import { useState } from 'react';
import { useStore } from '../store';
import Modals from './Modals';
import { HomeIcon } from './Icons';

export default function ClusterRail() {
  const clusters = useStore((s) => s.clusters);
  const currentClusterId = useStore((s) => s.currentClusterId);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const incoming = useStore((s) => s.incoming);
  const selectCluster = useStore((s) => s.selectCluster);
  const [modal, setModal] = useState<'create' | 'join' | null>(null);

  return (
    <nav className="rail">
      <button
        title="Amigos e mensagens diretas"
        className={`rail-item home ${view === 'home' ? 'active' : ''}`}
        onClick={() => setView('home')}
      >
        <HomeIcon size={20} />
        {incoming.length > 0 && <span className="rail-badge">{incoming.length}</span>}
      </button>
      <div className="rail-divider" />
      {clusters.map((c) => (
        <button
          key={c.id}
          title={c.name}
          className={`rail-item ${view === 'cluster' && currentClusterId === c.id ? 'active' : ''}`}
          style={!(view === 'cluster' && currentClusterId === c.id) ? { background: c.bannerColor } : undefined}
          onClick={() => selectCluster(c.id)}
        >
          {c.name.slice(0, 2).toUpperCase()}
        </button>
      ))}
      <div className="rail-divider" />
      <button className="rail-item add" title="Criar cluster" onClick={() => setModal('create')}>
        +
      </button>
      <button className="rail-item add" title="Entrar com convite" onClick={() => setModal('join')}>
        ⇄
      </button>
      {modal && <Modals kind={modal} onClose={() => setModal(null)} />}
    </nav>
  );
}
