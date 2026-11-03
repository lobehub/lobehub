import { describe, expect, it, vi } from 'vitest';

import {
  applyAcceptanceConfiguration,
  getReferrerOrigin,
  parseAcceptanceConfigureMessage,
  parseAcceptanceEmbedConfig,
} from './acceptanceEmbed';

describe('acceptance embed URL contract', () => {
  it('only enables embed and forced theme on an acceptance detail URL', () => {
    expect(
      parseAcceptanceEmbedConfig(
        'https://workbench.example/acceptance/report-id?embed=1&theme=dark&hl=de-DE',
      ),
    ).toEqual({ embed: true, theme: 'dark' });
    expect(
      parseAcceptanceEmbedConfig('https://workbench.example/acceptance?embed=1&theme=dark'),
    ).toEqual({ embed: false, theme: undefined });
    expect(
      parseAcceptanceEmbedConfig('https://workbench.example/verify/run-id?embed=1&theme=dark'),
    ).toEqual({ embed: false, theme: undefined });
  });

  it.each(['/acceptance/report-id/check/check-id', '/acceptance/report-id/check/check-id/'])(
    'keeps the check detail route %s outside embed mode',
    (path) => {
      expect(
        parseAcceptanceEmbedConfig(`https://workbench.example${path}?embed=1&theme=dark`),
      ).toEqual({ embed: false, theme: undefined });
    },
  );

  it('ignores invalid embed and theme values', () => {
    expect(
      parseAcceptanceEmbedConfig(
        'https://workbench.example/acceptance/report-id?embed=true&theme=dark',
      ),
    ).toEqual({ embed: false, theme: undefined });
    expect(
      parseAcceptanceEmbedConfig(
        'https://workbench.example/acceptance/report-id?embed=1&theme=system',
      ),
    ).toEqual({ embed: true, theme: undefined });
  });
});

describe('acceptance embed message validation', () => {
  const parentWindow = {} as Window;
  const validMessage = {
    data: { locale: 'de-DE', theme: 'dark', type: 'lobehub:acceptance:configure' },
    origin: 'https://parent.example',
    source: parentWindow,
  } as Pick<MessageEvent, 'data' | 'origin' | 'source'>;

  it('accepts a complete configuration from the exact trusted parent', () => {
    expect(
      parseAcceptanceConfigureMessage(validMessage, parentWindow, 'https://parent.example'),
    ).toEqual({ locale: 'de-DE', theme: 'dark', type: 'lobehub:acceptance:configure' });
  });

  it('rejects untrusted origins, sources, and invalid values', () => {
    expect(parseAcceptanceConfigureMessage(validMessage, parentWindow)).toBeUndefined();
    expect(
      parseAcceptanceConfigureMessage(
        { ...validMessage, origin: 'https://attacker.example' },
        parentWindow,
        'https://parent.example',
      ),
    ).toBeUndefined();
    expect(
      parseAcceptanceConfigureMessage(
        { ...validMessage, source: {} as Window },
        parentWindow,
        'https://parent.example',
      ),
    ).toBeUndefined();
    expect(
      parseAcceptanceConfigureMessage(
        { ...validMessage, data: { ...validMessage.data, locale: 'xx-YY' } },
        parentWindow,
        'https://parent.example',
      ),
    ).toBeUndefined();
    expect(
      parseAcceptanceConfigureMessage(
        { ...validMessage, data: { ...validMessage.data, theme: 'system' } },
        parentWindow,
        'https://parent.example',
      ),
    ).toBeUndefined();
  });

  it('derives an exact target origin only from a valid referrer', () => {
    expect(getReferrerOrigin('https://parent.example/path?q=1')).toBe('https://parent.example');
    expect(getReferrerOrigin('')).toBeUndefined();
    expect(getReferrerOrigin('not a URL')).toBeUndefined();
    expect(getReferrerOrigin('data:text/html,hello')).toBeUndefined();
    expect(getReferrerOrigin('file:///private/page.html')).toBeUndefined();
  });

  it('updates language, direction, and forced appearance without changing preferences', () => {
    localStorage.setItem('theme', 'light');
    const update = vi.fn();

    applyAcceptanceConfiguration(
      { locale: 'ar', theme: 'dark', type: 'lobehub:acceptance:configure' },
      document.documentElement,
      update,
    );

    expect(document.documentElement).toMatchObject({ dir: 'rtl', lang: 'ar' });
    expect(update).toHaveBeenCalledWith({
      locale: 'ar',
      theme: 'dark',
      type: 'lobehub:acceptance:configure',
    });
    expect(localStorage.getItem('theme')).toBe('light');
  });
});
