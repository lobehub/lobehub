import { describe, expect, it } from 'vitest';

import { describeSsoTicketMisconfiguration, getSsoTicketConfig } from './config';

const enabledEnv = {
  AUTH_SSO_TICKET_CLIENT_ID: 'lobehub',
  AUTH_SSO_TICKET_CLIENT_SECRET: 'secret-value',
  AUTH_SSO_TICKET_ENABLED: '1',
  AUTH_SSO_TICKET_EXCHANGE_URL: 'https://sso.example.com/auth/sso/ticket/exchange',
  AUTH_SSO_TICKET_LOGIN_DOMAIN: 'DEV',
};

describe('getSsoTicketConfig', () => {
  it('is disabled when AUTH_SSO_TICKET_ENABLED is absent', () => {
    const config = getSsoTicketConfig({});

    expect(config.requested).toBe(false);
    expect(config.enabled).toBe(false);
    expect(config.missing).toEqual([]);
  });

  it('is not requested when the flag is any value other than 1', () => {
    expect(getSsoTicketConfig({ AUTH_SSO_TICKET_ENABLED: 'true' }).requested).toBe(false);
    expect(getSsoTicketConfig({ AUTH_SSO_TICKET_ENABLED: '0' }).requested).toBe(false);
  });

  it('is enabled when the flag is 1 and all required values are present', () => {
    const config = getSsoTicketConfig(enabledEnv);

    expect(config.enabled).toBe(true);
    expect(config.missing).toEqual([]);
    expect(config.clientId).toBe('lobehub');
    expect(config.loginDomain).toBe('DEV');
    expect(config.providerId).toBe('tellhow-sso');
  });

  it('lists every missing required value instead of throwing at import time', () => {
    const config = getSsoTicketConfig({ AUTH_SSO_TICKET_ENABLED: '1' });

    expect(config.enabled).toBe(false);
    expect(config.missing).toEqual([
      'AUTH_SSO_TICKET_CLIENT_ID',
      'AUTH_SSO_TICKET_CLIENT_SECRET',
      'AUTH_SSO_TICKET_EXCHANGE_URL',
    ]);
  });

  it('treats blank strings as missing', () => {
    const config = getSsoTicketConfig({
      ...enabledEnv,
      AUTH_SSO_TICKET_CLIENT_SECRET: '   ',
    });

    expect(config.enabled).toBe(false);
    expect(config.missing).toContain('AUTH_SSO_TICKET_CLIENT_SECRET');
  });

  it('trims values and falls back to defaults', () => {
    const config = getSsoTicketConfig({
      ...enabledEnv,
      AUTH_SSO_TICKET_CLIENT_ID: '  lobehub  ',
    });

    expect(config.clientId).toBe('lobehub');
    expect(config.defaultRedirect).toBe('/');
    expect(config.emailDomain).toBe('tellhow.com');
    expect(config.timeoutMs).toBe(5000);
  });

  it('accepts overrides for provider id, email domain, redirect and timeout', () => {
    const config = getSsoTicketConfig({
      ...enabledEnv,
      AUTH_SSO_TICKET_DEFAULT_REDIRECT: '/chat',
      AUTH_SSO_TICKET_EMAIL_DOMAIN: 'Example.COM',
      AUTH_SSO_TICKET_PROVIDER_ID: 'custom-sso',
      AUTH_SSO_TICKET_TIMEOUT_MS: '1500',
    });

    expect(config.defaultRedirect).toBe('/chat');
    expect(config.emailDomain).toBe('Example.COM');
    expect(config.providerId).toBe('custom-sso');
    expect(config.timeoutMs).toBe(1500);
  });

  it('ignores invalid timeout values', () => {
    expect(
      getSsoTicketConfig({ ...enabledEnv, AUTH_SSO_TICKET_TIMEOUT_MS: 'abc' }).timeoutMs,
    ).toBe(5000);
    expect(getSsoTicketConfig({ ...enabledEnv, AUTH_SSO_TICKET_TIMEOUT_MS: '-1' }).timeoutMs).toBe(
      5000,
    );
  });

  it('reads the optional token-flow settings', () => {
    const config = getSsoTicketConfig({
      ...enabledEnv,
      AUTH_SSO_TICKET_CREATE_URL: 'https://sso.example.com/auth/sso/ticket/create',
      AUTH_SSO_TICKET_REDIRECT_URI: 'https://lobehub.example.com/api/auth/sso-ticket/callback',
    });

    expect(config.createUrl).toBe('https://sso.example.com/auth/sso/ticket/create');
    expect(config.redirectUri).toBe('https://lobehub.example.com/api/auth/sso-ticket/callback');
  });
});

describe('describeSsoTicketMisconfiguration', () => {
  it('returns undefined when SSO is disabled', () => {
    expect(describeSsoTicketMisconfiguration(getSsoTicketConfig({}))).toBeUndefined();
  });

  it('returns undefined when SSO is fully configured', () => {
    expect(describeSsoTicketMisconfiguration(getSsoTicketConfig(enabledEnv))).toBeUndefined();
  });

  it('names the missing keys when SSO is enabled but incomplete', () => {
    const message = describeSsoTicketMisconfiguration(
      getSsoTicketConfig({ AUTH_SSO_TICKET_ENABLED: '1' }),
    );

    expect(message).toContain('AUTH_SSO_TICKET_CLIENT_ID');
    expect(message).toContain('AUTH_SSO_TICKET_CLIENT_SECRET');
    expect(message).toContain('AUTH_SSO_TICKET_EXCHANGE_URL');
  });
});
