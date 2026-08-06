import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { type BetterAuthPlugin } from 'better-auth/types';
import { eq } from 'drizzle-orm';

import { users } from '@/database/schemas/user';
import { serverDB } from '@/database/server';
import { normalizeIranianPhoneNumber } from '@/libs/better-auth/phone';

export type PhoneLoginGateDecision =
  | { allow: true; reason: 'authenticated_verify' | 'verified' }
  | { allow: false; reason: 'unverified' };

/**
 * Phone OTP on the unauthenticated sign-in path is only for numbers that were
 * already verified on an account. Logged-in `/verify-phone` (session present /
 * `updatePhoneNumber`) may still OTP a new number.
 */
export const decidePhoneLoginGate = (input: {
  hasSession: boolean;
  path: string;
  phoneVerified: boolean;
  updatePhoneNumber?: boolean;
}): PhoneLoginGateDecision => {
  const isSendOtp = input.path === '/phone-number/send-otp';
  const isLoginVerify = input.path === '/phone-number/verify' && !input.updatePhoneNumber;
  const isAttachVerify = input.path === '/phone-number/verify' && input.updatePhoneNumber === true;

  if (isAttachVerify) return { allow: true, reason: 'authenticated_verify' };
  if (!isSendOtp && !isLoginVerify) return { allow: true, reason: 'verified' };

  if (input.phoneVerified) return { allow: true, reason: 'verified' };

  // Logged-in attach flow hits send-otp before the number is on the user row
  if (isSendOtp && input.hasSession) return { allow: true, reason: 'authenticated_verify' };

  return { allow: false, reason: 'unverified' };
};

const isVerifiedPhone = async (phone: string): Promise<boolean> => {
  const [row] = await serverDB
    .select({ phoneNumberVerified: users.phoneNumberVerified })
    .from(users)
    .where(eq(users.phone, phone))
    .limit(1);

  return Boolean(row?.phoneNumberVerified);
};

/**
 * Better Auth plugin: block phone OTP login for numbers that were never verified.
 */
export const phoneLoginGate = (): BetterAuthPlugin => ({
  id: 'phone-login-gate',
  hooks: {
    before: [
      {
        matcher: (ctx) =>
          ctx.path === '/phone-number/send-otp' ||
          (ctx.path === '/phone-number/verify' && !ctx.body?.updatePhoneNumber),
        handler: createAuthMiddleware(async (ctx) => {
          const rawPhone = ctx.body?.phoneNumber;
          if (typeof rawPhone !== 'string') return;

          const phone = normalizeIranianPhoneNumber(rawPhone) ?? rawPhone;
          const phoneVerified = await isVerifiedPhone(phone);
          const session = phoneVerified ? null : await getSessionFromCtx(ctx);
          const decision = decidePhoneLoginGate({
            hasSession: Boolean(session),
            path: ctx.path,
            phoneVerified,
            updatePhoneNumber: Boolean(ctx.body?.updatePhoneNumber),
          });

          if (decision.allow) return;

          throw new APIError('BAD_REQUEST', {
            code: 'PHONE_NUMBER_NOT_VERIFIED',
            message: 'PHONE_NUMBER_NOT_VERIFIED',
          });
        }),
      },
    ],
  },
});
