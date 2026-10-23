/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import RightPanel from './index';

vi.mock('@lobehub/ui', async (importOriginal) => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...(await importOriginal<typeof import('@lobehub/ui')>()),
  DraggablePanel: ({ children, expand }: { children: ReactNode; expand: boolean }) => (
    <aside data-expand={String(expand)} data-testid={'side-panel'}>
      {children}
    </aside>
  ),
  Drawer: ({
    children,
    onClose,
    open,
  }: {
    children: ReactNode;
    onClose: () => void;
    open: boolean;
  }) =>
    open ? (
      <div data-testid={'mobile-drawer'}>
        <button onClick={onClose}>close</button>
        {children}
      </div>
    ) : null,
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: unknown) => unknown) =>
    selector({ status: { showRightPanel: false }, toggleRightPanel: vi.fn() }),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: { showRightPanel: () => false },
}));

const onExpandChange = vi.fn();

beforeEach(() => {
  onExpandChange.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RightPanel', () => {
  it('stays a side panel on desktop', () => {
    render(
      <RightPanel expand onExpandChange={onExpandChange}>
        panel body
      </RightPanel>,
    );

    expect(screen.getByTestId('side-panel')).toHaveAttribute('data-expand', 'true');
    expect(onExpandChange).not.toHaveBeenCalled();
  });

  describe('on the mobile surface', () => {
    beforeEach(() => {
      vi.stubGlobal('__MOBILE__', true);
    });

    it('opens as a full-screen drawer instead of a side column', () => {
      render(
        <RightPanel expand onExpandChange={onExpandChange}>
          panel body
        </RightPanel>,
      );

      expect(screen.queryByTestId('side-panel')).not.toBeInTheDocument();
      expect(screen.getByTestId('mobile-drawer')).toHaveTextContent('panel body');
    });

    it('collapses a persisted open state on mount so it does not cover the page', () => {
      render(
        <RightPanel expand onExpandChange={onExpandChange}>
          panel body
        </RightPanel>,
      );

      expect(onExpandChange).toHaveBeenCalledWith(false);
    });

    it('closes through the drawer', () => {
      render(
        <RightPanel expand onExpandChange={onExpandChange}>
          panel body
        </RightPanel>,
      );
      onExpandChange.mockClear();

      screen.getByText('close').click();

      expect(onExpandChange).toHaveBeenCalledWith(false);
    });

    it('renders nothing while collapsed', () => {
      render(
        <RightPanel expand={false} onExpandChange={onExpandChange}>
          panel body
        </RightPanel>,
      );

      expect(screen.queryByText('panel body')).not.toBeInTheDocument();
      expect(onExpandChange).not.toHaveBeenCalled();
    });
  });
});
