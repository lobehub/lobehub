import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import BulkDeleteConfirmContent from './BulkDeleteConfirmContent';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => `${key}:${options?.count}`,
  }),
}));

describe('BulkDeleteConfirmContent', () => {
  it("warns with the count when the selection includes other members' tasks", () => {
    render(<BulkDeleteConfirmContent count={5} othersCount={2} />);

    expect(screen.getByText('taskList.bulk.deleteConfirm.content:5')).toBeTruthy();
    expect(screen.getByText('taskList.bulk.deleteConfirm.othersWarning:2')).toBeTruthy();
  });

  it('shows no warning when every selected task is the caller’s own', () => {
    render(<BulkDeleteConfirmContent count={5} othersCount={0} />);

    expect(screen.queryByText(/othersWarning/)).toBeNull();
  });
});
