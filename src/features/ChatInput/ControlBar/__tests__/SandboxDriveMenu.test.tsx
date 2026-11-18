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

describe('SandboxDriveMenu', () => {
  const onOpenStorage = vi.fn();
  const onPick = vi.fn();

  beforeEach(() => {
    onOpenStorage.mockClear();
    onPick.mockClear();
  });

  it('links to Sandbox Storage from the header without picking a folder', () => {
    render(<SandboxDriveMenu onBrowse={vi.fn()} onOpenStorage={onOpenStorage} onPick={onPick} />);

    expect(screen.getByText('sandboxDrive.title')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'sandboxDrive.openStorage' }));

    expect(onOpenStorage).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });
});
