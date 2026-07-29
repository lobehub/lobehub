import { describe, expect, it } from 'vitest';

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
