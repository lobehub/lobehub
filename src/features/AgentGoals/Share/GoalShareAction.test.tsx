/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import GoalShareAction from './GoalShareAction';

const mocks = vi.hoisted(() => ({
  canEdit: true,
  hasReport: true,
  manageable: true,
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: mocks.canEdit }),
}));

vi.mock('@/hooks/useResourceManageable', () => ({
  useResourceManageable: () => mocks.manageable,
}));

vi.mock('@/store/goal', () => ({
  goalSelectors: {
    goalGraph: () => () => ({
      goal: { id: 'goal_1', userId: 'user_1' },
      report: mocks.hasReport ? { latest: { version: 1 } } : undefined,
    }),
  },
  useGoalStore: (selector: (s: any) => unknown) => selector({}),
}));

// The real tooltip opens on a hover timer; what matters here is which text it is given and what it wraps.
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Tooltip: ({ children, title }: { children: ReactNode; title?: string }) => (
    <div data-testid="tooltip" data-title={title}>
      {children}
    </div>
  ),
}));

vi.mock('./GoalSharePopover', () => ({
  default: ({ goalId }: { goalId: string }) => <div data-testid="goal-share-popover">{goalId}</div>,
}));

beforeEach(() => {
  mocks.canEdit = true;
  mocks.hasReport = true;
  mocks.manageable = true;
});

describe('GoalShareAction', () => {
  it('offers an enabled Share button once the goal has a report', () => {
    render(<GoalShareAction goalId="goal_1" />);

    const button = screen.getByRole('button', { name: 'goalDetail.share.action' });
    expect(button).not.toHaveProperty('disabled', true);
    expect(button.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('disables the button, and says why, while the goal has no report', () => {
    mocks.hasReport = false;
    const { container } = render(<GoalShareAction goalId="goal_1" />);

    const button = container.querySelector('button')!;
    expect(button.disabled).toBe(true);

    // A disabled button never fires pointer events, so the reason hangs off its wrapper.
    expect(screen.getByTestId('tooltip').getAttribute('data-title')).toBe(
      'goalDetail.share.disabledNoReport',
    );
    expect(screen.getByTestId('tooltip').contains(button)).toBe(true);
  });

  it('hides the button from a viewer who cannot manage the goal', () => {
    mocks.manageable = false;
    const { container } = render(<GoalShareAction goalId="goal_1" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('hides the button from a viewer without edit permission', () => {
    mocks.canEdit = false;
    const { container } = render(<GoalShareAction goalId="goal_1" />);

    expect(container).toBeEmptyDOMElement();
  });
});
