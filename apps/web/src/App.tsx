import { useEffect } from 'react';
import { bootstrapSession, useStore } from './store';
import AuthScreen from './screens/AuthScreen';
import ClusterRail from './components/ClusterRail';
import ChannelSidebar from './components/ChannelSidebar';
import ChatView from './components/ChatView';
import MemberBar from './components/MemberBar';
import CommandPalette from './components/CommandPalette';

export default function App() {
  const user = useStore((s) => s.user);
  const wsConnected = useStore((s) => s.wsConnected);
  const currentChannelId = useStore((s) => s.currentChannelId);

  useEffect(() => {
    bootstrapSession();
    const onWs = (e: Event) => {
      useStore.getState().setWsConnected((e as CustomEvent).detail.connected);
    };
    window.addEventListener('vyre:ws', onWs);
    return () => window.removeEventListener('vyre:ws', onWs);
  }, []);

  // Assina o canal ativo quando ele muda
  useEffect(() => {
    if (currentChannelId) {
      useStore.getState().selectChannel(currentChannelId);
    }
  }, [currentChannelId]);

  if (!user) return <AuthScreen />;

  return (
    <div className="app">
      <ClusterRail />
      <div className="main">
        <ChannelSidebar />
        <ChatView />
        <MemberBar />
      </div>
      <CommandPalette />
      <div className={`ws-pill ${wsConnected ? 'on' : ''}`}>
        {wsConnected ? '● ao vivo' : '○ desconectado'}
      </div>
    </div>
  );
}
