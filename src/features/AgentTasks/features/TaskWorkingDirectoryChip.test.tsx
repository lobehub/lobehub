/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import TaskWorkingDirectoryChip from './TaskWorkingDirectoryChip';

const mocks = vi.hoisted(() => ({ useFetchDevices: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/WorkingDirectory', () => ({ openAddWorkingDirModal: vi.fn() }));

vi.mock('@/services/device', () => ({ deviceService: { statPath: vi.fn() } }));

vi.mock('@/store/device', () => ({
  deviceSelectors: {
    getDeviceDefaultCwd: () => () => undefined,
    getDeviceWorkingDirs: () => () => [],
  },
  useDeviceStore: (selector: (state: unknown) => unknown) =>
    selector({ useFetchDevices: mocks.useFetchDevices }),
}));

describe('TaskWorkingDirectoryChip', () => {
  // The recents come from the device store, and a task page may render nothing
  // else that fetches devices — the picker listed no directories on a cold load.
  it('fetches the device list it reads its recents from', () => {
    render(<TaskWorkingDirectoryChip deviceId="device-1" onChange={vi.fn()} />);

    expect(mocks.useFetchDevices).toHaveBeenCalledWith(true);
  });
});
