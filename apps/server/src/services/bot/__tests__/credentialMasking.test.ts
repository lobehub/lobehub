// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  containsMaskedCredential,
  CREDENTIAL_MASK,
  maskCredentials,
  resolveMaskedCredentials,
} from '../credentialMasking';

describe('maskCredentials', () => {
  it('masks a secret but keeps the identifier beside it', () => {
    // Discord declares publicKey as `string` and botToken as `password`, which
    // is the distinction the mask reads.
    const masked = maskCredentials('discord', { botToken: 'real-token', publicKey: 'abc123' });

    expect(masked).toEqual({ botToken: CREDENTIAL_MASK, publicKey: 'abc123' });
  });

  it('masks every feishu secret', () => {
    const masked = maskCredentials('feishu', {
      appSecret: 's',
      encryptKey: 'e',
      verificationToken: 'v',
    });

    expect(Object.values(masked)).toEqual([CREDENTIAL_MASK, CREDENTIAL_MASK, CREDENTIAL_MASK]);
  });

  it('keeps the identifiers a QR-provisioned platform declares, and masks its token', () => {
    // WeChat has no credentials in its form schema, so the split comes from
    // `publicCredentialKeys` on the platform definition instead.
    const masked = maskCredentials('wechat', {
      botId: 'bot-1',
      botToken: 'real-token',
      userId: 'user-1',
    });

    expect(masked).toEqual({ botId: 'bot-1', botToken: CREDENTIAL_MASK, userId: 'user-1' });
  });

  it('leaves the iMessage bridge credentials readable', () => {
    // The desktop bridge holds `webhookSecret` as a shared secret and cannot
    // ask for it back; masking it would make the two sides disagree.
    const masked = maskCredentials('imessage', {
      desktopDeviceId: 'dev-1',
      webhookSecret: 'shared-secret',
    });

    expect(masked).toEqual({ desktopDeviceId: 'dev-1', webhookSecret: 'shared-secret' });
  });

  it('treats an unclassified key as a secret', () => {
    // Fail-closed: a platform that forgets to declare a field leaks nothing.
    expect(maskCredentials('discord', { somethingNew: 'value' })).toEqual({
      somethingNew: CREDENTIAL_MASK,
    });
  });

  it('leaves an empty value empty so "not configured" stays readable', () => {
    expect(maskCredentials('discord', { botToken: '' })).toEqual({ botToken: '' });
  });

  it('returns an empty object for a row with no credentials', () => {
    expect(maskCredentials('discord', null)).toEqual({});
  });
});

describe('resolveMaskedCredentials', () => {
  const stored = { botToken: 'real-token', publicKey: 'abc123' };

  it('restores the stored secret when the form hands back the mask untouched', () => {
    // The model replaces the blob wholesale, so this is what stops an untouched
    // save from either persisting the mask or deleting the secret.
    expect(resolveMaskedCredentials({ botToken: CREDENTIAL_MASK, publicKey: 'abc123' }, stored)) //
      .toEqual(stored);
  });

  it('takes a real edit over the stored value', () => {
    expect(resolveMaskedCredentials({ botToken: 'rotated', publicKey: 'abc123' }, stored)).toEqual({
      botToken: 'rotated',
      publicKey: 'abc123',
    });
  });

  it('restores the secret when the placeholder came back padded', () => {
    // The form accepts a padded placeholder as unchanged, so treating it as a
    // new secret here would persist dots over a live credential — the damage
    // lands hardest on platforms whose fields carry no format pattern.
    expect(resolveMaskedCredentials({ botToken: `  ${CREDENTIAL_MASK}  ` }, stored)).toEqual({
      botToken: 'real-token',
    });
  });

  it('drops a mask that stands for nothing', () => {
    expect(resolveMaskedCredentials({ botToken: CREDENTIAL_MASK }, {})).toEqual({});
  });

  it('does not resurrect a key the caller removed', () => {
    expect(resolveMaskedCredentials({ publicKey: 'abc123' }, stored)).toEqual({
      publicKey: 'abc123',
    });
  });
});

describe('containsMaskedCredential', () => {
  it.each([
    [{ botToken: CREDENTIAL_MASK }, true],
    [{ botToken: `  ${CREDENTIAL_MASK}  ` }, true],
    [{ botToken: 'real' }, false],
    [{}, false],
    [undefined, false],
  ])('%o → %s', (credentials, expected) => {
    expect(containsMaskedCredential(credentials as Record<string, string>)).toBe(expected);
  });
});
