import { describe, expect, it } from 'vitest';

import { getSsoTicketConfig } from './config';
import {
  buildSsoAccountInput,
  buildSsoUserInput,
  generateSsoEmail,
  normalizeUserCode,
} from './userMapping';

const config = getSsoTicketConfig({
  AUTH_SSO_TICKET_CLIENT_ID: 'lobehub',
  AUTH_SSO_TICKET_CLIENT_SECRET: 'secret',
  AUTH_SSO_TICKET_ENABLED: '1',
  AUTH_SSO_TICKET_EXCHANGE_URL: 'https://sso.example.com/exchange',
});

const profile = {
  realName: '张三',
  roleCodes: ['developer'],
  userCode: 'A123456',
  userId: 'dev-user-001',
};

describe('normalizeUserCode', () => {
  it('trims, lowercases and strips unsafe characters', () => {
    expect(normalizeUserCode('  A123456  ')).toBe('a123456');
    expect(normalizeUserCode('a 12/34_56')).toBe('a123456');
    expect(normalizeUserCode('A-12.34')).toBe('a-12.34');
  });

  it('returns an empty string for empty or unusable codes', () => {
    expect(normalizeUserCode(undefined)).toBe('');
    expect(normalizeUserCode('   ')).toBe('');
    expect(normalizeUserCode('张三')).toBe('');
  });
});

describe('generateSsoEmail', () => {
  it('builds a stable email from the employee code', () => {
    expect(generateSsoEmail('A123456', 'tellhow.com')).toBe('a123456@tellhow.com');
  });

  it('lowercases the domain', () => {
    expect(generateSsoEmail('A123456', 'TellHow.COM')).toBe('a123456@tellhow.com');
  });

  it('throws SSO_TICKET_USERINFO_INVALID when the code cannot produce an email', () => {
    expect(() => generateSsoEmail('张三', 'tellhow.com')).toThrowError(
      expect.objectContaining({ code: 'SSO_TICKET_USERINFO_INVALID' }),
    );
    expect(() => generateSsoEmail('', 'tellhow.com')).toThrowError(
      expect.objectContaining({ code: 'SSO_TICKET_USERINFO_INVALID' }),
    );
  });
});

describe('buildSsoUserInput', () => {
  it('maps the profile onto the LobeHub user shape', () => {
    expect(buildSsoUserInput(profile, config)).toEqual({
      email: 'a123456@tellhow.com',
      emailVerified: true,
      fullName: '张三',
      name: '张三',
      username: 'A123456',
    });
  });

  it('keeps the original employee code as username', () => {
    expect(buildSsoUserInput({ ...profile, userCode: ' b0099 ' }, config).username).toBe('b0099');
  });

  it('uses the configured email domain', () => {
    const custom = getSsoTicketConfig({
      ...process.env,
      AUTH_SSO_TICKET_CLIENT_ID: 'lobehub',
      AUTH_SSO_TICKET_CLIENT_SECRET: 'secret',
      AUTH_SSO_TICKET_EMAIL_DOMAIN: 'corp.example',
      AUTH_SSO_TICKET_ENABLED: '1',
      AUTH_SSO_TICKET_EXCHANGE_URL: 'https://sso.example.com/exchange',
    });

    expect(buildSsoUserInput(profile, custom).email).toBe('a123456@corp.example');
  });
});

describe('buildSsoAccountInput', () => {
  it('uses providerId + userId as the stable external identity', () => {
    expect(buildSsoAccountInput(profile, 'user-1', 'tellhow-sso')).toEqual({
      accountId: 'dev-user-001',
      providerId: 'tellhow-sso',
      userId: 'user-1',
    });
  });

  it('rejects a profile without userId', () => {
    expect(() =>
      buildSsoAccountInput({ ...profile, userId: '' }, 'user-1', 'tellhow-sso'),
    ).toThrowError(expect.objectContaining({ code: 'SSO_TICKET_USERINFO_INVALID' }));
  });
});
