import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import GoalDetailTitle from './GoalDetailTitle';

vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/hooks/useResourceManageable', () => ({ useResourceManageable: () => true }));
vi.mock('@/store/goal', () => ({
  goalSelectors: { isGoalTitleRenaming: () => () => false },
  useGoalStore: (selector: (s: unknown) => unknown) => selector({}),
}));
vi.mock('./useGoalActions', () => ({ useGoalRename: () => ({ rename: vi.fn() }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('GoalDetailTitle', () => {
  it('stays the page heading and names its editor for screen readers', () => {
    render(<GoalDetailTitle goalId={'goal_1'} title={'Desk pet'} />);

    const editor = screen.getByRole('textbox', { name: 'rename' });
    expect(editor).toHaveValue('Desk pet');
    expect(screen.getByRole('heading', { level: 1 })).toContainElement(editor);
  });
});
