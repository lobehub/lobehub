import { generateKeyPairSync } from 'node:crypto';

import { decodeJwt } from 'jose';
import { expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ JWKS_KEY: '', INTERNAL_JWT_EXPIRATION: '30s' }));
vi.mock('@/envs/auth', () => ({ authEnv: env }));
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
env.JWKS_KEY = JSON.stringify({
  keys: [{ ...privateKey.export({ format: 'jwk' }), alg: 'RS256', kid: 'fixture' }],
});
const grant = {
  userId: 'A',
  workspaceId: 'workspace',
  deviceId: 'B-device',
  operationId: 'A-op',
  assistantMessageId: 'assistant',
  toolCallId: 'call_1',
  toolMessageId: 'tool',
  identifier: 'fixture',
  apiName: 'form',
};
it('signs only a narrow expiring invocation ticket, never a general user or operation credential', async () => {
  const {
    signMcpDeviceGrant,
    validateMcpDeviceGrant,
    validateInternalJWT,
    validateHeteroOperationJWT,
  } = await import('./internalJwt');
  const deadline = Date.now() + 30_000;
  const token = await signMcpDeviceGrant(grant, deadline);
  expect(await validateMcpDeviceGrant(token)).toEqual({ ...grant, deadline });
  expect(decodeJwt(token).exp! * 1000).toBeLessThanOrEqual(deadline + 1000);
  expect(await validateInternalJWT(token)).toBe(false);
  expect(await validateHeteroOperationJWT(token)).toBeNull();
  const expired = await signMcpDeviceGrant(grant, Date.now() - 2_000);
  expect(await validateMcpDeviceGrant(expired)).toBeNull();
  expect(await validateMcpDeviceGrant(token.slice(0, -6) + 'AAAAAA')).toBeNull();
});
