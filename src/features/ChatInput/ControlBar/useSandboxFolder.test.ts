import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSandboxFolder } from './useSandboxFolder';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const getInstance = vi.hoisted(() => vi.fn());
vi.mock('@/services/sandboxStorage', () => ({ sandboxStorageService: { getInstance } }));

beforeEach(() => {
  getInstance.mockReset();
});

describe('useSandboxFolder', () => {
  it('names a folder by its last segment, and the root as the root', () => {
    expect(
      renderHook(() => useSandboxFolder({ workingDirectory: 'projects/demo' }, true)).result
        .current,
    ).toEqual({ label: 'demo', path: 'projects/demo' });
    expect(
      renderHook(() => useSandboxFolder({ workingDirectory: '.' }, true)).result.current,
    ).toEqual({ label: 'sandboxDrive.root', path: '.' });
  });

  it('names nothing for a temporary sandbox', () => {
    expect(renderHook(() => useSandboxFolder({}, true)).result.current).toEqual({
      label: undefined,
      path: undefined,
    });
  });

  // T-14825: the drive menu shows no environment item any more — a legacy
  // environment directory is the folder it is on the drive, named by its
  // folder and picked like any other row of the list.
  it('names a legacy environment directory by its folder, not by the environment', async () => {
    getInstance.mockResolvedValue({ name: 'Lobe Chat env', workingDirectory: 'envs/chat-dir' });

    const { result } = renderHook(() => useSandboxFolder({ instanceId: 'inst-1' }, true));

    await waitFor(() =>
      expect(result.current).toEqual({ label: 'chat-dir', path: 'envs/chat-dir' }),
    );
    expect(getInstance).toHaveBeenCalledWith({ id: 'inst-1' });
  });
});
