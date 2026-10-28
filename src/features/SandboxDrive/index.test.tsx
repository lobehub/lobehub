import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import DriveSettings from './index';

const entitlement = vi.hoisted(() => ({ value: {} as any }));

vi.mock('@/hooks/useSandboxDriveEntitlement', () => ({
  useSandboxDriveEntitlement: () => entitlement.value,
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => null,
}));
vi.mock('@/business/client/features/SandboxStorageUpsell', () => ({
  SandboxStorageUpgradeGuide: () => null,
}));
vi.mock('./DriveExplorer', () => ({ default: () => null }));
vi.mock('./DriveUsage', () => ({ default: () => null }));

describe('DriveSettings', () => {
  it('should offer a retry, not an endless spinner, when the entitlement cannot be read', () => {
    const retry = vi.fn();
    entitlement.value = { entitled: undefined, error: new Error('offline'), retry };
    render(
      <MemoryRouter>
        <DriveSettings />
      </MemoryRouter>,
    );

    expect(screen.getByText('drive.loadFailed')).toBeInTheDocument();
    fireEvent.click(screen.getByText('retry'));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
