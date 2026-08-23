const YJS_WEBSOCKET_PORT = '12345';

export const resolveYjsWebSocketUrl = (
  location?: Pick<Location, 'host' | 'hostname' | 'protocol'>,
  configuredUrl = process.env.NEXT_PUBLIC_PAGE_COLLABORATION_URL,
) => {
  if (configuredUrl?.trim()) return configuredUrl.trim().replace(/\/$/, '');
  if (!location) return `ws://localhost:${YJS_WEBSOCKET_PORT}`;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';

  return `${protocol}//${location.hostname}:${YJS_WEBSOCKET_PORT}`;
};
