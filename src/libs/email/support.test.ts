import { describe, expect, it } from 'vitest';

import { EMAIL_SUPPORT_ADDRESS, getEmailSupportHtml, getEmailSupportText } from './support';

describe('email support helpers', () => {
  it('renders actionable support links for HTML and plain-text emails', () => {
    const html = getEmailSupportHtml();
    const text = getEmailSupportText();

    expect(EMAIL_SUPPORT_ADDRESS).toBe('support@lobehub.com');
    expect(html).toContain('href="mailto:support@lobehub.com"');
    expect(html).toContain('https://discord.gg/');
    expect(text).toContain('support@lobehub.com');
    expect(text).toContain('https://discord.gg/');
  });

  it('escapes localized labels before rendering HTML', () => {
    const html = getEmailSupportHtml({
      contactSupport: '<script>alert("support")</script>',
      joinDiscord: '<strong>Discord</strong>',
    });

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<strong>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;strong&gt;');
  });
});
