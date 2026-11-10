import { fireEvent, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore, Provider } from '@/features/Conversation/store';
import { useCanEditCodexMessage } from '@/hooks/useCanEditCodexMessage';
import { usePermission } from '@/hooks/usePermission';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { useDoubleClickEdit } from './useDoubleClickEdit';

vi.mock('@/hooks/useCanEditCodexMessage', () => ({ useCanEditCodexMessage: vi.fn() }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: vi.fn(() => ({ allowed: true })) }));

/** @example Alt-double-click follows the same Codex user-edit eligibility as the toolbar. */
describe('Codex user edit shortcut', () => {
  beforeEach(() => vi.mocked(usePermission).mockReturnValue({ allowed: true }));
  afterEach(() => vi.restoreAllMocks());

  const setup = (provider: 'codex' | 'claude-code', supported: boolean, role = 'user') => {
    vi.mocked(useCanEditCodexMessage).mockReturnValue(supported);
    vi.spyOn(agentByIdSelectors, 'getAgencyConfigById').mockImplementation(
      (id) => () => (id === 'owner' ? { heterogeneousProvider: { type: provider } } : undefined),
    );
    const store = createStore({
      context: { agentId: 'owner', topicId: 'source', threadId: null },
    });
    const toggle = vi.spyOn(store.getState(), 'toggleMessageEditing');
    const Bubble = () =>
      createElement('div', {
        'data-testid': 'message',
        'onDoubleClick': useDoubleClickEdit({ id: 'message', role, error: undefined }),
      });
    const view = render(
      createElement(Provider, { children: createElement(Bubble), createStore: () => store }),
    );
    return { bubble: view.getByTestId('message'), toggle };
  };

  /** @example A Codex runtime that cannot resend must not open a Save-only dead end. */
  it('blocks unsupported Codex user editing before opening the editor', () => {
    // ROOT CAUSE:
    // The toolbar checked effective runtime, but Alt-double-click only checked
    // role and content permission. It opened an editor whose new Codex submit
    // path always rejected. The shortcut must apply the same runtime gate.
    const { bubble, toggle } = setup('codex', false);
    fireEvent.doubleClick(bubble, { altKey: true });
    /** @example Unsupported Codex user rows keep the editor closed. */
    expect(toggle).not.toHaveBeenCalled();
    /** @example Eligibility belongs to the captured conversation, not global selection. */
    expect(useCanEditCodexMessage).toHaveBeenCalledWith('owner', 'source');
  });

  /** @example A local Codex user prompt still opens Edit with Alt-double-click. */
  it('opens supported Codex user editing', () => {
    const { bubble, toggle } = setup('codex', true);
    fireEvent.doubleClick(bubble, { altKey: true });
    /** @example The existing editor owns the selected historical message. */
    expect(toggle).toHaveBeenCalledWith('message', true);
  });

  /** @example Ordinary messages keep their existing shortcut behavior. */
  it('keeps non-Codex editing available', () => {
    const { bubble, toggle } = setup('claude-code', false);
    fireEvent.doubleClick(bubble, { altKey: true });
    /** @example The Codex runtime gate does not disable ordinary editing. */
    expect(toggle).toHaveBeenCalledWith('message', true);
  });
});
