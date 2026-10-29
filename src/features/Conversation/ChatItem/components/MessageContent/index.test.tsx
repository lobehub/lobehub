import { render } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PrintModeContext } from '@/features/Conversation/components/PrintModeContext';
import { createStore, Provider } from '@/features/Conversation/store';

import MessageContent from './index';

const openEditorModal = vi.fn(() => ({ close: vi.fn(), update: vi.fn() }) as any);

vi.mock('@/features/EditorModal', () => ({
  openEditorModal: (...args: any[]) => openEditorModal(...(args as [])),
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

/** @example Printing must not open a second editor against the real one's store flag. */
describe('MessageContent editing lifecycle', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const setup = (printing: boolean) => {
    const store = createStore({
      context: { agentId: 'agent', topicId: 'topic', threadId: null },
      messages: [
        { id: 'm1', content: 'hello', role: 'user', createdAt: 0, updatedAt: 0 } as any,
      ],
    });
    const toggleMessageEditing = vi.spyOn(store.getState(), 'toggleMessageEditing');
    const wrapper = ({ children }: PropsWithChildren) => (
      <Provider createStore={() => store}>
        {printing ? <PrintModeContext value>{children}</PrintModeContext> : children}
      </Provider>
    );
    return { ...render(<MessageContent editing id={'m1'} message={'hello'} />, { wrapper }), toggleMessageEditing };
  };

  /** @example The screen row opens its editor and closes it on unmount. */
  it('opens the editor for the real row', () => {
    const { unmount } = setup(false);

    expect(openEditorModal).toHaveBeenCalledTimes(1);

    unmount();
    expect(openEditorModal.mock.results[0]!.value.close).toHaveBeenCalledTimes(1);
  });

  /** @example The print copy stays inert: no editor, so no draft-losing close on afterprint. */
  it('does not touch the editor lifecycle in the print copy', () => {
    const { unmount, toggleMessageEditing } = setup(true);

    expect(openEditorModal).not.toHaveBeenCalled();

    unmount();
    expect(openEditorModal).not.toHaveBeenCalled();
    expect(toggleMessageEditing).not.toHaveBeenCalled();
  });
});
