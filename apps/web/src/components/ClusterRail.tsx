import { useState } from 'react';
import { useStore } from '../store';
import Modals from './Modals';

export default function ClusterRail() {
  const clusters = useStore((s) => s.clusters);
  const currentClusterId = useStore((s) => s.currentClusterId);
  const selectCluster = useStore((s) => s.selectCluster);
  const [modal, setModal] = useState<'create' | 'join' | null>(null);

  return (
    <nav className="rail">
      {clusters.map((c) => (
        <button
          key={c.id}
          title={c.name}
          className={`rail-item ${currentClusterId === c.id ? 'active' : ''}`}
          style={!currentClusterId || currentClusterId !== c.id ? { background: c.bannerColor } : undefined}
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
