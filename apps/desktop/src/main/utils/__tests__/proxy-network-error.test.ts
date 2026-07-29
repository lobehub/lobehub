import { describe, expect, it } from 'vitest';

import { classifyProxyNetworkError } from '../proxy-network-error';

describe('classifyProxyNetworkError', () => {
  it.each([
    ['net::ERR_INTERNET_DISCONNECTED', 'RemoteServerOffline'],
    ['net::ERR_TIMED_OUT', 'RemoteServerTimeout'],
    ['net::ERR_CONNECTION_TIMED_OUT', 'RemoteServerTimeout'],
    ['ETIMEDOUT', 'RemoteServerTimeout'],
    ['net::ERR_NAME_NOT_RESOLVED', 'RemoteServerDNSFailed'],
    ['net::ERR_NAME_RESOLUTION_FAILED', 'RemoteServerDNSFailed'],
    ['getaddrinfo ENOTFOUND example.com', 'RemoteServerDNSFailed'],
    ['net::ERR_CONNECTION_REFUSED', 'RemoteServerConnectionRefused'],
    ['net::ERR_CONNECTION_RESET', 'RemoteServerConnectionRefused'],
    ['net::ERR_CONNECTION_CLOSED', 'RemoteServerConnectionRefused'],
    ['connect ECONNREFUSED 127.0.0.1:443', 'RemoteServerConnectionRefused'],
    ['net::ERR_CERT_AUTHORITY_INVALID', 'RemoteServerCertInvalid'],
    ['net::ERR_SSL_PROTOCOL_ERROR', 'RemoteServerCertInvalid'],
    ['net::ERR_FAILED', 'RemoteServerUnreachable'],
    ['something completely unexpected', 'RemoteServerUnreachable'],
  ])('maps %s to %s', (reason, expected) => {
    expect(classifyProxyNetworkError(reason)).toBe(expected);
  });
});
