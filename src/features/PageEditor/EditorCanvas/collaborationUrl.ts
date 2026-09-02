const YJS_WEBSOCKET_PORT = '12345';

type RuntimeEnvironment = 'development' | 'production' | (string & {});

export const resolveYjsWebSocketUrl = (
  location?: Pick<Location, 'host' | 'hostname' | 'protocol'>,
  configuredUrl = process.env.NEXT_PUBLIC_PAGE_COLLABORATION_URL,
  environment: RuntimeEnvironment = process.env.NODE_ENV,
) => {
  const configured = configuredUrl?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  if (environment !== 'development') return undefined;
  if (!location) return `ws://localhost:${YJS_WEBSOCKET_PORT}`;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';

  return `${protocol}//${location.hostname}:${YJS_WEBSOCKET_PORT}`;
};
