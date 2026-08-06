import { describe, expect, it } from 'vitest';

import { decidePhoneLoginGate } from './phone-login-gate';

describe('decidePhoneLoginGate', () => {
  it('allows send-otp when the phone is already verified', () => {
    expect(
      decidePhoneLoginGate({
        hasSession: false,
        path: '/phone-number/send-otp',
        phoneVerified: true,
      }),
    ).toEqual({ allow: true, reason: 'verified' });
  });

  it('blocks send-otp for unverified phones without a session', () => {
    expect(
      decidePhoneLoginGate({
        hasSession: false,
        path: '/phone-number/send-otp',
        phoneVerified: false,
      }),
    ).toEqual({ allow: false, reason: 'unverified' });
  });

  it('allows send-otp for unverified phones when the user is authenticated', () => {
    expect(
      decidePhoneLoginGate({
        hasSession: true,
        path: '/phone-number/send-otp',
        phoneVerified: false,
      }),
    ).toEqual({ allow: true, reason: 'authenticated_verify' });
  });

  it('blocks login verify for unverified phones', () => {
    expect(
      decidePhoneLoginGate({
        hasSession: false,
        path: '/phone-number/verify',
        phoneVerified: false,
        updatePhoneNumber: false,
      }),
    ).toEqual({ allow: false, reason: 'unverified' });
  });

  it('allows login verify when the phone is already verified', () => {
    expect(
      decidePhoneLoginGate({
        hasSession: false,
        path: '/phone-number/verify',
        phoneVerified: true,
        updatePhoneNumber: false,
      }),
    ).toEqual({ allow: true, reason: 'verified' });
  });

  it('allows attach verify (updatePhoneNumber) regardless of prior verification', () => {
    expect(
      decidePhoneLoginGate({
        hasSession: true,
        path: '/phone-number/verify',
        phoneVerified: false,
        updatePhoneNumber: true,
      }),
    ).toEqual({ allow: true, reason: 'authenticated_verify' });
  });
});
