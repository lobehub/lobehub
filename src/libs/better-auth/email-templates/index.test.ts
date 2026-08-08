import {
  BRANDING_EMAIL,
  BRANDING_EMOJI,
  BRANDING_NAME,
  SOCIAL_URL,
} from '@lobechat/business-const';
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
  it.each(templates)('uses Panachat branding instead of LobeHub', (template) => {
    expect(template.html).toContain(BRANDING_EMOJI);
    expect(template.html).toContain(BRANDING_NAME);
    expect(template.html).not.toContain('LobeHub');
    expect(template.html).not.toContain('🤯');
    expect(template.subject).not.toContain('LobeHub');
  });

  it.each(templates)('includes support links only when branding provides them', (template) => {
    const supportEmail = BRANDING_EMAIL.support?.trim();
    const discordUrl = SOCIAL_URL.discord?.trim();

    if (supportEmail) {
      expect(template.html).toContain(`mailto:${supportEmail}`);
      expect(template.text).toContain(supportEmail);
    } else {
      expect(template.html).not.toContain('mailto:');
    }

    if (discordUrl) {
      expect(template.html).toContain(discordUrl);
      expect(template.text).toContain(discordUrl);
    }

    expect(template.html).not.toContain('undefined');
    expect(template.text).not.toContain('undefined');
  });
});
