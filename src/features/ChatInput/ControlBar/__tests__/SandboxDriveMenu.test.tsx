import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SandboxDriveMenu from '../SandboxDriveMenu';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => undefined,
}));

vi.mock('@/services/sandboxStorage', () => ({
  sandboxStorageService: { listFiles: vi.fn(async () => ({ entries: [] })) },
}));

const props = {
  onBrowse: vi.fn(),
  onPick: vi.fn(),
  onPickTemporary: vi.fn(),
  onUpgrade: vi.fn(),
};

// T-14791: storage is one level under the cloud sandbox — a temporary
// sandbox, or a folder of the drive.
describe('SandboxDriveMenu', () => {
  beforeEach(() => {
    for (const fn of Object.values(props)) fn.mockClear();
  });

  it('offers the temporary sandbox above the drive folders', async () => {
    render(<SandboxDriveMenu entitled temporary {...props} />);

    fireEvent.click(screen.getByText('sandboxOptions.temporary'));
    expect(props.onPickTemporary).toHaveBeenCalledTimes(1);

    fireEvent.click(await screen.findByText('sandboxDrive.root'));
    expect(props.onPick).toHaveBeenCalledWith({ drive: undefined, workingDirectory: '.' });
    expect(screen.getByText('sandboxDrive.browseOther')).toBeInTheDocument();
  });

  it('leads a plan without a drive to one instead of listing folders', () => {
    render(<SandboxDriveMenu temporary entitled={false} {...props} />);

    expect(screen.queryByText('sandboxDrive.root')).toBeNull();
    fireEvent.click(screen.getByText('sandboxDrive.title'));
    expect(props.onUpgrade).toHaveBeenCalledTimes(1);
  });

  it('offers only the temporary sandbox without a drive service', () => {
    render(<SandboxDriveMenu temporary {...props} />);

    expect(screen.getByText('sandboxOptions.temporary')).toBeInTheDocument();
    expect(screen.queryByText('sandboxDrive.title')).toBeNull();
    expect(screen.queryByText('sandboxDrive.root')).toBeNull();
  });
});
