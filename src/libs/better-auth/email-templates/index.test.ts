import type * as BusinessConst from '@lobechat/business-const';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getChangeEmailVerificationTemplate,
  getMagicLinkEmailTemplate,
  getResetPasswordEmailTemplate,
  getVerificationEmailTemplate,
  getVerificationOTPEmailTemplate,
  getWorkspaceInviteEmailTemplate,
  getWorkspaceMemberRemovedEmailTemplate,
} from './index';

const templates = [
  getChangeEmailVerificationTemplate({
    expiresInSeconds: 3600,
    url: 'https://example.com/change-email',
  }),
  getMagicLinkEmailTemplate({
    expiresInSeconds: 600,
    url: 'https://example.com/sign-in',
  }),
  getResetPasswordEmailTemplate({ url: 'https://example.com/reset-password' }),
  getVerificationEmailTemplate({
    expiresInSeconds: 3600,
    url: 'https://example.com/verify-email',
  }),
  getVerificationOTPEmailTemplate({ expiresInSeconds: 600, otp: '123456' }),
  getWorkspaceInviteEmailTemplate({
    expiresInDays: 7,
    role: 'member',
    url: 'https://example.com/invite',
    workspaceName: 'Example Workspace',
  }),
  getWorkspaceMemberRemovedEmailTemplate({
    reason: 'removed_by_owner',
    workspaceName: 'Example Workspace',
  }),
];

describe('email templates', () => {
  it.each(templates)(
    'includes support email and Discord links in HTML and plain text',
    (template) => {
      expect(template.html).toContain('href="mailto:support@lobehub.com"');
      expect(template.html).toContain('https://discord.gg/');
      expect(template.text).toContain('support@lobehub.com');
      expect(template.text).toContain('https://discord.gg/');
    },
  );
});

describe('email templates under custom branding', () => {
  afterEach(() => {
    vi.doUnmock('@lobechat/business-const');
    vi.resetModules();
  });

  // These templates never pass through i18next, so the locale brand
  // post-processor can't reach them — every brand mention has to come from the
  // slot. Render each one under a renamed brand and require no upstream name
  // anywhere in what is mailed.
  it('mail no upstream brand name in the subject, HTML or plain text', async () => {
    vi.resetModules();
    vi.doMock('@lobechat/business-const', async (importOriginal) => ({
      ...(await importOriginal<typeof BusinessConst>()),
      BRANDING_NAME: 'Acme',
      COPYRIGHT_FULL: '© Acme Inc. All rights reserved.',
      ORG_NAME: 'Acme Inc',
    }));
    // Under vitest 5 a `doMock` only lands once the test file itself imports
    // something, so pull the mocked module in before the templates.
    await import('@lobechat/business-const');
    const T = await import('./index');

    const rendered = [
      T.getChangeEmailVerificationTemplate({ expiresInSeconds: 3600, url: 'https://x.test' }),
      T.getMagicLinkEmailTemplate({ expiresInSeconds: 600, url: 'https://x.test' }),
      T.getResetPasswordEmailTemplate({ url: 'https://x.test' }),
      T.getVerificationEmailTemplate({ expiresInSeconds: 3600, url: 'https://x.test' }),
      T.getVerificationOTPEmailTemplate({ expiresInSeconds: 600, otp: '123456' }),
      T.getWorkspaceInviteEmailTemplate({
        expiresInDays: 7,
        role: 'member',
        url: 'https://x.test',
        workspaceName: 'WS',
      }),
      T.getWorkspaceMemberRemovedEmailTemplate({ reason: 'removed_by_owner', workspaceName: 'WS' }),
    ];

    for (const { html, subject, text } of rendered) {
      for (const part of [html, subject, text]) {
        expect(part).not.toMatch(/LobeHub|LobeChat|Lobe AI/);
      }
      expect(html).toContain('Acme');
    }
  });
});
