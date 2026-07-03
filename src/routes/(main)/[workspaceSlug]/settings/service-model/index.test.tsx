import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import WorkspaceServiceModelSetting from './index';

vi.mock('@/routes/(main)/settings/service-model', () => ({
  default: () => <div data-testid="service-model-page">service model settings</div>,
}));

describe('WorkspaceServiceModelSetting', () => {
  it('reuses the service model settings page', () => {
    render(<WorkspaceServiceModelSetting />);

    expect(screen.getByTestId('service-model-page')).toHaveTextContent('service model settings');
  });
});
