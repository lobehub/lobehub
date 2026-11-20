import { describe, expect, it, vi } from 'vitest';

const { desktop, remoteServerUrl } = vi.hoisted(() => ({
  desktop: { value: false },
  remoteServerUrl: vi.fn(() => 'https://lobe.example.com/'),
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  get isDesktop() {
    return desktop.value;
  },
}));
vi.mock('@/store/electron', () => ({ getElectronStoreState: () => ({}) }));
vi.mock('@/store/electron/selectors', () => ({ electronSyncSelectors: { remoteServerUrl } }));

const { resolveArtboardFileBase } = await import('./fileBase');

describe('resolveArtboardFileBase', () => {
  it('keeps the server path on the web', () => {
    desktop.value = false;
    expect(resolveArtboardFileBase('/artboard-files/tok/')).toBe('/artboard-files/tok/');
  });

  it('points the desktop app at its remote server', () => {
    desktop.value = true;
    expect(resolveArtboardFileBase('/artboard-files/tok/')).toBe(
      'https://lobe.example.com/artboard-files/tok/',
    );
  });

  it('has no base when the server issued none', () => {
    expect(resolveArtboardFileBase(null)).toBeNull();
  });
});
