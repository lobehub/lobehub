// Local mirror of `@lobechat/types`' ChatErrorType RemoteServer* members —
// the desktop tsconfig doesn't expose `@lobechat/types` (runtime stub leak risk).
export type ProxyNetworkErrorType =
  | 'RemoteServerOffline'
  | 'RemoteServerTimeout'
  | 'RemoteServerDNSFailed'
  | 'RemoteServerConnectionRefused'
  | 'RemoteServerCertInvalid'
  | 'RemoteServerUnreachable';

const MATCHERS: [RegExp, ProxyNetworkErrorType][] = [
  [/INTERNET_DISCONNECTED/i, 'RemoteServerOffline'],
  [/TIMED_OUT|ETIMEDOUT|TIMEOUT/i, 'RemoteServerTimeout'],
  [/NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|ENOTFOUND|EAI_AGAIN|DNS/i, 'RemoteServerDNSFailed'],
  [
    /CONNECTION_REFUSED|CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_ABORTED|ECONNREFUSED|ECONNRESET/i,
    'RemoteServerConnectionRefused',
  ],
  [/CERT_|_CERT|SSL_|_SSL|CERTIFICATE/i, 'RemoteServerCertInvalid'],
];

export const classifyProxyNetworkError = (reason: string): ProxyNetworkErrorType => {
  for (const [pattern, errorType] of MATCHERS) {
    if (pattern.test(reason)) return errorType;
  }
  return 'RemoteServerUnreachable';
};
