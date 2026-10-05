/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import TaskWorkingDirectoryChip from './TaskWorkingDirectoryChip';

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  // Render the picker inline so the recents are assertable without opening it.
  Popover: ({ children, content }: { children: ReactNode; content: ReactNode }) => (
    <>
      {children}
      {content}
    </>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/WorkingDirectory', () => ({ openAddWorkingDirModal: vi.fn() }));

vi.mock('@/services/device', () => ({ deviceService: { statPath: vi.fn() } }));

vi.mock('@/features/DeviceManager/useDeviceList', () => ({
  useDeviceList: () => ({
    data: [
      {
        defaultCwd: null,
        deviceId: 'device-1',
        workingDirs: [{ path: '/repos/notification-center' }],
      },
    ],
  }),
}));

describe('TaskWorkingDirectoryChip', () => {
  // The recents used to come from the device store, which a task page may never
  // populate — the picker listed no directories on a cold load.
  it('lists the recents of the target device from the device list', () => {
    render(<TaskWorkingDirectoryChip deviceId="device-1" onChange={vi.fn()} />);

    expect(screen.getByText('/repos/notification-center')).toBeInTheDocument();
  });
});
