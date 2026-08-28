import { describe, expect, it } from 'vitest';

import { expireLegacyHostOnlyCookies } from './host-only-cookies';

const SESSION_TOKEN = '__Secure-better-auth.session_token';
const EXPIRED = 'Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';

const createRequest = (headers: HeadersInit = {}) =>
  new Request('https://app.example.com/api/auth/get-session', { headers });

const createResponse = (setCookies: string[]) => {
  const response = new Response(null);
  for (const cookie of setCookies) response.headers.append('set-cookie', cookie);

  return response;
};

const run = (setCookies: string[], headers?: HeadersInit) =>
  expireLegacyHostOnlyCookies(
    createRequest(headers),
    createResponse(setCookies),
    '.example.com',
  ).headers.getSetCookie();

describe('expireLegacyHostOnlyCookies', () => {
  it('mirrors the attributes of the domain-scoped cookie minus its domain', () => {
    expect(
      run([`${SESSION_TOKEN}=token; Path=/; Domain=.example.com; HttpOnly; Secure; SameSite=Lax`]),
    ).toEqual([
      `${SESSION_TOKEN}=token; Path=/; Domain=.example.com; HttpOnly; Secure; SameSite=Lax`,
      `${SESSION_TOKEN}=; Path=/; ${EXPIRED}; SameSite=Lax; HttpOnly; Secure`,
    ]);
  });

  it('expires the host-only twin when sign-out clears the domain-scoped cookie', () => {
    expect(
      run([`${SESSION_TOKEN}=; Max-Age=0; Path=/; Domain=.example.com; HttpOnly; Secure`]),
    ).toEqual([
      `${SESSION_TOKEN}=; Max-Age=0; Path=/; Domain=.example.com; HttpOnly; Secure`,
      `${SESSION_TOKEN}=; Path=/; ${EXPIRED}; HttpOnly; Secure`,
    ]);
  });

  it('matches the configured domain regardless of a leading dot or casing', () => {
    expect(run([`${SESSION_TOKEN}=token; Path=/; Domain=Example.com`])).toEqual([
      `${SESSION_TOKEN}=token; Path=/; Domain=Example.com`,
      `${SESSION_TOKEN}=; Path=/; ${EXPIRED}`,
    ]);
  });

  it('covers every domain-scoped cookie once', () => {
    expect(
      run([
        `${SESSION_TOKEN}=token; Path=/; Domain=.example.com`,
        `${SESSION_TOKEN}=token; Path=/; Domain=.example.com`,
        '__Secure-better-auth.session_data=data; Path=/; Domain=.example.com',
      ]),
    ).toEqual([
      `${SESSION_TOKEN}=token; Path=/; Domain=.example.com`,
      `${SESSION_TOKEN}=token; Path=/; Domain=.example.com`,
      '__Secure-better-auth.session_data=data; Path=/; Domain=.example.com',
      `${SESSION_TOKEN}=; Path=/; ${EXPIRED}`,
      '__Secure-better-auth.session_data=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    ]);
  });

  it('ignores cookies that are host-only or scoped to another domain', () => {
    const setCookies = [
      `${SESSION_TOKEN}=token; Path=/; Secure`,
      'analytics=1; Path=/; Domain=.other.com',
    ];

    expect(run(setCookies)).toEqual(setCookies);
  });

  it('skips native clients that store cookies without a domain', () => {
    const setCookies = [`${SESSION_TOKEN}=token; Path=/; Domain=.example.com; Secure`];

    expect(run(setCookies, { 'expo-origin': 'com.lobehub.app://' })).toEqual(setCookies);
  });
});
