/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import TaskVisibilityChipLabel from './TaskVisibilityChipLabel';

vi.mock('@lobehub/ui', () => ({
  Block: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Icon: () => <span />,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('antd-style', () => ({
  cssVar: {
    colorTextDescription: '#999',
    colorTextSecondary: '#666',
  },
}));

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
