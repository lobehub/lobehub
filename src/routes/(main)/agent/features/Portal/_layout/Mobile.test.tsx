/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import Mobile from './Mobile';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({ container: 'threadContainer', modal: 'mobileModal' }),
  cx: (...classNames: Array<string | false | undefined>) => classNames.filter(Boolean).join(' '),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ImperativeModal', () => ({
  default: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className} role="dialog">
      {children}
    </div>
  ),
}));

vi.mock('@/features/Portal/router', () => ({
  PortalContent: () => <div>portal content</div>,
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: object) => unknown) =>
    selector({ clearPortalStack: vi.fn(), showPortal: true }),
}));

vi.mock('@/store/chat/selectors', () => ({
  portalThreadSelectors: { showThread: () => false },
}));

describe('Mobile portal layout', () => {
  it('applies the near-full-height mobile panel style to every portal view', () => {
    render(<Mobile />);

    expect(screen.getByRole('dialog')).toHaveClass('mobileModal');
  });
});
