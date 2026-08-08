import { describe, expect, it } from 'vitest';

import { EMAIL_SUPPORT_ADDRESS, getEmailSupportHtml, getEmailSupportText } from './support';

describe('email support helpers', () => {
  it('omits missing support/discord branding instead of crashing', () => {
    // Aico self-host branding leaves SOCIAL_URL.discord undefined and may leave
    // BRANDING_SUPPORT_EMAIL empty — verification emails must still render.
    expect(() => getEmailSupportHtml()).not.toThrow();
    expect(() => getEmailSupportText()).not.toThrow();

    const html = getEmailSupportHtml();
    const text = getEmailSupportText();

    if (EMAIL_SUPPORT_ADDRESS?.trim()) {
      expect(html).toContain(`mailto:${EMAIL_SUPPORT_ADDRESS.trim()}`);
      expect(text).toContain(EMAIL_SUPPORT_ADDRESS.trim());
    } else {
      expect(html).not.toContain('mailto:');
      expect(text).toBe('');
    }

    expect(html).not.toContain('undefined');
    expect(text).not.toContain('undefined');
  });

  it('escapes localized labels before rendering HTML when support email is set', () => {
    if (!EMAIL_SUPPORT_ADDRESS?.trim()) {
      // Without a support address the HTML footer is empty; escaping is still
      // covered for contact labels when an address exists.
      expect(getEmailSupportHtml({ contactSupport: '<script>' })).toBe('');
      return;
    }

    const html = getEmailSupportHtml({
      contactSupport: '<script>alert("support")</script>',
      joinDiscord: '<strong>Discord</strong>',
    });

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<strong>');
    expect(html).toContain('&lt;script&gt;');
  });
});
