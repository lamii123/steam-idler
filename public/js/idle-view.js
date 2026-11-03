const NOTICES = Object.freeze({
  playingElsewhere:
    'Idling stopped — Steam only allows one active session. You started playing on your Steam client.',
  autoStopped: 'Idle timer finished.',
});

/**
 * Project an `/api/idle/status` payload into one view model. The four status
 * branches (reconnecting, connecting, idling, online) no longer repeat the
 * same DOM calls, and the stop notice comes from the server's reason instead
 * of a flag remembered in the controller.
 */
export function idleView(status = {}, previous = {}) {
  const connected = Boolean(status.connected);
  const idling = Boolean(status.idling);
  const connecting = Boolean(status.connecting);
  const reconnecting = Boolean(status.reconnecting);
  const wasIdling = Boolean(previous.wasIdling);

  let mode = 'offline';
  if (reconnecting) mode = 'reconnecting';
  else if (connecting) mode = 'connecting';
  else if (connected) mode = idling ? 'idling' : 'online';

  const showIdle = idling || ((connecting || reconnecting) && wasIdling);
  const gameId = showIdle && Array.isArray(status.appIds) ? status.appIds[0] : null;
  const notice = !idling && wasIdling && status.reason ? NOTICES[status.reason] || '' : '';

  return {
    mode,
    connected,
    showIdle,
    gameId: gameId === undefined ? null : gameId,
    since: showIdle ? status.since || null : null,
    stopAt: showIdle ? status.stopAt || null : null,
    notice,
  };
}
