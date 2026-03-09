import { getValidToken } from '../auth/refresh';
import { log } from '../utils/logger';

// Must match the server's SECRET_XOR_KEY (src/envs/auth.ts)
const SECRET_XOR_KEY = 'LobeHub · LobeHub';

/**
 * XOR-obfuscate a payload and encode as Base64.
 * The /webapi/* routes require `X-lobe-chat-auth` with this encoding.
 */
function obfuscatePayloadWithXOR(payload: Record<string, any>): string {
  const jsonString = JSON.stringify(payload);
  const dataBytes = new TextEncoder().encode(jsonString);
  const keyBytes = new TextEncoder().encode(SECRET_XOR_KEY);

  const result = new Uint8Array(dataBytes.length);
  for (let i = 0; i < dataBytes.length; i++) {
    result[i] = dataBytes[i] ^ keyBytes[i % keyBytes.length];
  }

  return btoa(String.fromCharCode(...result));
}

export interface AuthInfo {
  accessToken: string;
  /** Headers required for /webapi/* endpoints (includes both X-lobe-chat-auth and Oidc-Auth) */
  headers: Record<string, string>;
  serverUrl: string;
}

export async function getAuthInfo(): Promise<AuthInfo> {
  const result = await getValidToken();
  if (!result) {
    log.error("No authentication found. Run 'lh login' first.");
    process.exit(1);
  }

  const { serverUrl, accessToken } = result!.credentials;

  return {
    accessToken,
    headers: {
      'Content-Type': 'application/json',
      'Oidc-Auth': accessToken,
      'X-lobe-chat-auth': obfuscatePayloadWithXOR({}),
    },
    serverUrl: serverUrl.replace(/\/$/, ''),
  };
}
