import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import WorkspaceServiceModelSetting from './index';

const managePermission = vi.hoisted(() => ({ allowed: true }));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: managePermission.allowed }),
}));

vi.mock('@/business/client/hooks/useIsWorkspaceLoading', () => ({
  useIsWorkspaceLoading: () => false,
}));

vi.mock('@/features/Settings/service-model', () => ({
  default: () => <div data-testid="service-model-page">service model settings</div>,
}));

describe('WorkspaceServiceModelSetting', () => {
  it('reuses the service model settings page for admins', () => {
    managePermission.allowed = true;
    render(<WorkspaceServiceModelSetting />);

    expect(screen.getByTestId('service-model-page')).toHaveTextContent('service model settings');
  });

  it('renders forbidden screen without manage_settings permission', () => {
    managePermission.allowed = false;
    render(<WorkspaceServiceModelSetting />);

    expect(screen.queryByTestId('service-model-page')).toBeNull();
    expect(screen.getByText('403')).toBeInTheDocument();
  });
});
