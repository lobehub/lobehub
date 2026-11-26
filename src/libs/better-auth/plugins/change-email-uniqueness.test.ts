// @vitest-environment node
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { describe, expect, it, vi } from 'vitest';

import { CHANGE_EMAIL_IN_USE_CODE } from '../constants';
import { changeEmailUniqueness } from './change-email-uniqueness';

const BASE_URL = 'http://localhost:3000';
const PASSWORD = 'password-123456';

/**
 * A real Better Auth instance with the production change-email setup (enabled, verification
 * email configured, no confirmation to the old address), so the test exercises Better Auth's
 * actual existing-email branch instead of asserting hook wiring.
 */
const createAuth = (plugins = [changeEmailUniqueness()]) => {
  const db: Record<string, any[]> = { account: [], session: [], user: [], verification: [] };
  const sendVerificationEmail = vi.fn(async (_data: unknown, _request?: Request) => {});
  const auth = betterAuth({
    baseURL: BASE_URL,
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    emailVerification: { sendVerificationEmail },
    plugins,
    secret: 'test-secret-test-secret-test-secret',
    user: { changeEmail: { enabled: true } },
  });

  return { auth, sendVerificationEmail };
};

const signUp = async (auth: ReturnType<typeof createAuth>['auth'], email: string) => {
  const result = await auth.api.signUpEmail({
    body: { email, name: email, password: PASSWORD },
    returnHeaders: true,
  });
  const cookie = result.headers.get('set-cookie')?.match(/better-auth\.session_token=[^;]+/)?.[0];
  if (!cookie) throw new Error(`Sign-up for ${email} returned no session cookie`);

  return new Headers({ cookie, origin: BASE_URL });
};

const changeEmail = (
  auth: ReturnType<typeof createAuth>['auth'],
  headers: Headers,
  newEmail: string,
) =>
  auth.api.changeEmail({
    body: { callbackURL: '/settings/profile', newEmail },
    headers,
  });

describe('changeEmailUniqueness', () => {
  it('rejects an address that already belongs to another account instead of reporting a sent email', async () => {
    const { auth, sendVerificationEmail } = createAuth();
    const headers = await signUp(auth, 'current@example.com');
    await signUp(auth, 'taken@example.com');

    await expect(changeEmail(auth, headers, 'Taken@Example.com')).rejects.toMatchObject({
      body: { code: CHANGE_EMAIL_IN_USE_CODE },
      statusCode: 400,
    });
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('documents the Better Auth default this plugin overrides: silent success without email', async () => {
    const { auth, sendVerificationEmail } = createAuth([]);
    const headers = await signUp(auth, 'current@example.com');
    await signUp(auth, 'taken@example.com');

    await expect(changeEmail(auth, headers, 'taken@example.com')).resolves.toEqual({
      status: true,
    });
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('still sends the verification email for an unused address', async () => {
    const { auth, sendVerificationEmail } = createAuth();
    const headers = await signUp(auth, 'current@example.com');

    await expect(changeEmail(auth, headers, 'new@example.com')).resolves.toEqual({
      status: true,
    });
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(sendVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ email: 'new@example.com' }) }),
      undefined,
    );
  });

  it('leaves the requester’s own address to Better Auth’s same-email error', async () => {
    const { auth } = createAuth();
    const headers = await signUp(auth, 'current@example.com');

    await expect(changeEmail(auth, headers, 'current@example.com')).rejects.toMatchObject({
      body: { message: 'Email is the same' },
    });
  });
});
