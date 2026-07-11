/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import VisibilityConfirmContent from './index';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => (
    <div data-testid="content-shell">{children}</div>
  ),
  Icon: ({ size }: { icon: unknown; size?: number }) => (
    <span data-icon-size={size} data-testid="icon" />
  ),
}));

describe('VisibilityConfirmContent', () => {
  it('renders 3 makePrivate items in escalation order with an irreversible suffix on the last', () => {
    render(<VisibilityConfirmContent variant="makePrivate" />);
    // All three item text keys should surface as the last two direct-child spans
    // in each <li>. We assert by looking up the concrete i18n key strings.
    expect(screen.getByText('visibilityConfirm.makePrivate.itemAccess')).toBeTruthy();
    expect(screen.getByText('visibilityConfirm.makePrivate.itemReferences')).toBeTruthy();
    expect(screen.getByText('visibilityConfirm.makePrivate.itemLoaded')).toBeTruthy();
    // The irreversible tag should render exactly once, next to the last item.
    expect(screen.getAllByText('visibilityConfirm.irreversible')).toHaveLength(1);
  });

  it('renders 3 publish items — visible / reversible / irreversible-tail', () => {
    render(<VisibilityConfirmContent variant="publish" />);
    expect(screen.getByText('visibilityConfirm.publish.itemVisible')).toBeTruthy();
    expect(screen.getByText('visibilityConfirm.publish.itemReversible')).toBeTruthy();
    expect(screen.getByText('visibilityConfirm.publish.itemLoaded')).toBeTruthy();
    expect(screen.getAllByText('visibilityConfirm.irreversible')).toHaveLength(1);
  });
});
