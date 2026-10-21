import { useEffect } from 'react';
import { bootstrapSession, useStore } from './store';
import AuthScreen from './screens/AuthScreen';
import ClusterRail from './components/ClusterRail';
import ChannelSidebar from './components/ChannelSidebar';
import ChatView from './components/ChatView';
import MemberBar from './components/MemberBar';
import CommandPalette from './components/CommandPalette';
import FriendsHome from './components/FriendsHome';
import ProfilePopout from './components/ProfilePopout';
import ClusterSettingsModal from './components/ClusterSettingsModal';
import PlusModal from './components/PlusModal';

export default function App() {
  const user = useStore((s) => s.user);
  const wsConnected = useStore((s) => s.wsConnected);
  const currentChannelId = useStore((s) => s.currentChannelId);
  const view = useStore((s) => s.view);
  const profileUsername = useStore((s) => s.profileUsername);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const plusOpen = useStore((s) => s.plusOpen);

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
    if (currentChannelId && view === 'cluster') {
      useStore.getState().selectChannel(currentChannelId);
    }
  }, [currentChannelId, view]);

  if (!user) return <AuthScreen />;

  return (
    <div className="app">
      <ClusterRail />
      <div className="main">
        {view === 'home' ? (
          <FriendsHome />
        ) : (
          <>
            <ChannelSidebar />
            <ChatView />
            <MemberBar />
          </>
        )}
      </div>
      <CommandPalette />
      {profileUsername && <ProfilePopout />}
      {settingsOpen && <ClusterSettingsModal />}
      {plusOpen && <PlusModal onClose={() => useStore.getState().closePlus()} />}
      <div className={`ws-pill ${wsConnected ? 'on' : ''}`}>
        {wsConnected ? '● ao vivo' : '○ desconectado'}
      </div>
    </div>
  );
}
