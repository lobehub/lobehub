import { beforeEach, describe, expect, it, vi } from 'vitest';

const heteroSession = vi.hoisted(() => ({
  getDirPrefs: vi.fn(),
  listLocalSessions: vi.fn(),
  readLocalSession: vi.fn(),
  setDirPref: vi.fn(),
}));

vi.mock('@/utils/electron/ipc', () => ({
  ensureElectronIpc: () => ({ heteroSession }),
}));

describe('electronHeteroSessionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards scan and pref calls over the heteroSession IPC group', async () => {
    const { electronHeteroSessionService } = await import('./heteroSession');
    const scan = { errors: [], groups: [] };
    heteroSession.listLocalSessions.mockResolvedValue(scan);
    heteroSession.readLocalSession.mockResolvedValue(null);
    heteroSession.getDirPrefs.mockResolvedValue({});
    heteroSession.setDirPref.mockResolvedValue(undefined);

    await expect(electronHeteroSessionService.listLocalSessions()).resolves.toEqual(scan);
    await expect(
      electronHeteroSessionService.readLocalSession({
        filePath: '/tmp/session.jsonl',
        source: 'claude-code',
      }),
    ).resolves.toBeNull();
    await expect(electronHeteroSessionService.getDirPrefs()).resolves.toEqual({});
    await expect(
      electronHeteroSessionService.setDirPref({ key: 'claude-code::/repo', pref: null }),
    ).resolves.toBeUndefined();

    expect(heteroSession.listLocalSessions).toHaveBeenCalledOnce();
    expect(heteroSession.readLocalSession).toHaveBeenCalledWith({
      filePath: '/tmp/session.jsonl',
      source: 'claude-code',
    });
    expect(heteroSession.setDirPref).toHaveBeenCalledWith({
      key: 'claude-code::/repo',
      pref: null,
    });
  });
});
