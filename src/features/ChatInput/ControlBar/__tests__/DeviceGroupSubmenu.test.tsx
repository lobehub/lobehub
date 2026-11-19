import type { DeviceListItem } from '@lobechat/types';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import DeviceGroupSubmenu from '../DeviceGroupSubmenu';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

// The popover itself is @lobehub/ui's; what matters here is what the group puts
// on the first level and what it hands the second level.
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Popover: ({ children, content }: { children: ReactNode; content: ReactNode }) => (
    <div>
      {children}
      <div data-testid={'submenu'}>{content}</div>
    </div>
  ),
}));

const device = (deviceId: string, online: boolean, friendlyName?: string) =>
  ({
    channels: [],
    deviceId,
    friendlyName,
    hostname: deviceId,
    online,
  }) as unknown as DeviceListItem;

const devices = [
  device('hetzner', true, 'Hetzner 8C64G'),
  device('zeabur', true),
  device('lin-pc', false),
];

describe('DeviceGroupSubmenu', () => {
  it('keeps one first-level row by title only, and lists the devices in the submenu', () => {
    render(
      <DeviceGroupSubmenu
        devices={devices}
        kind={'private'}
        label={'Private Devices'}
        renderDevice={(d) => <div key={d.deviceId}>row:{d.deviceId}</div>}
      />,
    );

    const groupRow = screen.getByTestId('device-group-private');
    expect(groupRow.textContent).toContain('Private Devices');
    expect(groupRow.textContent).toBe('Private Devices');
    expect(groupRow.textContent).not.toContain('row:');

    const submenu = screen.getByTestId('submenu');
    expect(submenu.textContent).toContain('row:hetzner');
    expect(submenu.textContent).toContain('row:zeabur');
    expect(submenu.textContent).toContain('row:lin-pc');
  });

  it('names the picked device on the first level when it is in the group', () => {
    render(
      <DeviceGroupSubmenu
        activeDeviceId={'hetzner'}
        devices={devices}
        kind={'private'}
        label={'Private Devices'}
        renderDevice={(d) => <div key={d.deviceId}>row:{d.deviceId}</div>}
      />,
    );

    expect(screen.getByTestId('device-group-private').textContent).toContain('Hetzner 8C64G');
  });

  it('hands a device click to the row the caller renders', () => {
    const onSelect = vi.fn();
    render(
      <DeviceGroupSubmenu
        devices={devices}
        kind={'workspace'}
        label={'Workspace Devices'}
        renderDevice={(d) => (
          <button key={d.deviceId} type={'button'} onClick={() => onSelect(d.deviceId)}>
            {d.deviceId}
          </button>
        )}
      />,
    );

    fireEvent.click(screen.getByText('zeabur'));
    expect(onSelect).toHaveBeenCalledWith('zeabur');
  });
});
