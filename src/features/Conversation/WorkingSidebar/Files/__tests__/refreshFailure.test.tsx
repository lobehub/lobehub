import { render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';

import { gitFilesMock, projectFilesMock } from './harness';

// Loaded after the harness so its module mocks are registered first.
let Files: ComponentType<{ workingDirectory: string }>;

beforeAll(async () => {
  Files = (await import('../index')).default;
});

describe('Files — refresh failure with a saved tree', () => {
  it('keeps the saved tree but says it could not refresh', () => {
    projectFilesMock.error = new Error('index read failed');

    render(<Files workingDirectory="/repo" />);

    expect(screen.getByTestId('explorer-tree')).toBeInTheDocument();
    expect(screen.getByText('workingPanel.files.refreshFailed')).toBeInTheDocument();
  });

  it('surfaces a failed git overlay refresh on the same saved tree', () => {
    gitFilesMock.error = new Error('git status failed');

    render(<Files workingDirectory="/repo" />);

    expect(screen.getByTestId('explorer-tree')).toBeInTheDocument();
    expect(screen.getByText('workingPanel.files.refreshFailed')).toBeInTheDocument();
  });

  it('stays quiet when both refreshes succeed', () => {
    render(<Files workingDirectory="/repo" />);

    expect(screen.queryByText('workingPanel.files.refreshFailed')).not.toBeInTheDocument();
  });
});
