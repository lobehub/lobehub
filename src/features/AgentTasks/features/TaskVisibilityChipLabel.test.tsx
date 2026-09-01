/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import TaskVisibilityChipLabel from './TaskVisibilityChipLabel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      const resources: Record<string, string> = {
        'createTask.visibility.private': '私人',
        'createTask.visibility.workspace': '工作区',
      };

      return resources[key] ?? options?.defaultValue ?? key;
    },
  }),
}));

describe('TaskVisibilityChipLabel', () => {
  it('uses the workspace label for public visibility', () => {
    render(<TaskVisibilityChipLabel visibility="public" />);

    expect(screen.getByText('工作区')).toBeInTheDocument();
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
  });
});
