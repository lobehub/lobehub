import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { app, isDev } = vi.hoisted(() => ({
  app: {
    commandLine: { appendSwitch: vi.fn() },
    getPath: vi.fn(() => '/app-data'),
    setName: vi.fn(),
    setPath: vi.fn(),
  },
  isDev: vi.fn(() => true),
}));

vi.mock('electron', () => ({ app }));
vi.mock('@/utils/platform', () => ({ dev: isDev }));

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;

const load = async ({ platform: name, userData }: { platform: string; userData?: string }) => {
  Object.defineProperty(process, 'platform', { value: name });
  vi.stubEnv('LOBE_DESKTOP_USER_DATA_DIR', userData ?? '');
  await import('./pre-app-init');
};

describe('pre-app-init', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', platform);
    vi.unstubAllEnvs();
  });

  it('keeps a launcher-managed macOS instance off the system keychain', async () => {
    await load({ platform: 'darwin', userData: '/checkout/.cache/desktop-user-data' });

    expect(app.setPath).toHaveBeenCalledWith('userData', '/checkout/.cache/desktop-user-data');
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('use-mock-keychain');
  });

  it('keeps the keychain for the shared dev profile and other platforms', async () => {
    await load({ platform: 'darwin' });
    expect(app.setPath).toHaveBeenCalledWith('userData', '/app-data/lobehub-desktop-dev');

    vi.resetModules();
    await load({ platform: 'linux', userData: '/checkout/.cache/desktop-user-data' });

    expect(app.commandLine.appendSwitch).not.toHaveBeenCalled();
  });
});
