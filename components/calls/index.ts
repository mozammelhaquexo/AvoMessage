/**
 * components/calls — audio calling UI + orchestration.
 *
 * Integration (one line, in the authenticated app shell, inside SocketProvider):
 *
 *   <CallProvider currentUser={{ id: user.id, name: user.name, avatarUrl: user.avatarUrl }}>
 *     {children}
 *   </CallProvider>
 *
 * Then anywhere inside: `const { startCall } = useCall();`
 *   await startCall({ userIds: ['<peerId>'], type: 'AUDIO' });
 *   await startCall({ conversationId: '<id>', type: 'AUDIO' });
 */
export { CallProvider, useCall, type CallContextValue, type CallCurrentUser } from './CallProvider';
export { CallWindow, type CallWindowProps, type CallWindowMode, type CallPeerDisplay } from './CallWindow';
export { CallHistory, type CallHistoryProps } from './CallHistory';
