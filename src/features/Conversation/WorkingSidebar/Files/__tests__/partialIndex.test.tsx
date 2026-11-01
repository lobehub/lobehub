import { render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { projectFilesMock } from './harness';

// Loaded after the harness so its module mocks are registered first.
let Files: ComponentType<{ workingDirectory: string }>;

beforeAll(async () => {
  Files = (await import('../index')).default;
});

describe('Files — partial index', () => {
  beforeEach(() => {
    projectFilesMock.data.source = 'git';
    projectFilesMock.data.persistedPartial = undefined;
    projectFilesMock.isValidating = false;
    projectFilesMock.data.entries = [...projectFilesMock.baseEntries];
  });

  it('flags a saved partial tree only once its refresh is no longer running', () => {
    // Restored from a capped row (a large project) while the refresh is in flight.
    projectFilesMock.data.persistedPartial = true;
    projectFilesMock.isValidating = true;
    const { unmount } = render(<Files workingDirectory="/repo" />);
    expect(screen.queryByText('workingPanel.files.partialIndexNotice')).not.toBeInTheDocument();
    unmount();

    // The refresh failed: the partial tree is all there is, and it must say so.
    projectFilesMock.isValidating = false;
    render(<Files workingDirectory="/repo" />);
    expect(screen.getByText('workingPanel.files.partialIndexNotice')).toBeInTheDocument();
  });

  it('does not flag a complete tree', () => {
    render(<Files workingDirectory="/repo" />);

    expect(screen.queryByText('workingPanel.files.partialIndexNotice')).not.toBeInTheDocument();
  });
});
