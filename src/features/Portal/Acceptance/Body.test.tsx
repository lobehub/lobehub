import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { draftToMainComposer, useComposerDraftBus } from '@/features/Conversation/composerDraftBus';

import Body from './Body';

const mocks = vi.hoisted(() => ({
  captured: { onDraftToComposer: undefined as undefined | ((text: string) => boolean) },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/chat/selectors', () => ({
  chatPortalSelectors: { acceptancePortalId: () => 'acc-1' },
}));

// P0 regression (blank "页面暂时不可用" crash): the portal pane is a layout
// sibling of the conversation column, OUTSIDE ConversationProvider — Body must
// never read the context store. Mock it as throwing, exactly like
// zustand-utils does without a provider ancestor; rendering Body must survive.
vi.mock('@/features/Conversation/store', () => ({
  useConversationStore: () => {
    throw new Error('Seems like you have not used zustand provider as an ancestor.');
  },
}));

vi.mock('@/features/Verify', () => ({
  AcceptanceViewer: (props: { onDraftToComposer?: (text: string) => boolean }) => {
    mocks.captured.onDraftToComposer = props.onDraftToComposer;
    return null;
  },
}));

describe('Portal Acceptance Body — draftToComposer via the global bus', () => {
  beforeEach(() => {
    useComposerDraftBus.setState({ attached: false, draft: null });
  });

  it('renders outside ConversationProvider without touching the context store', () => {
    expect(() => render(<Body />)).not.toThrow();
    // The poster is the plain bus function — no context-store closure involved.
    expect(mocks.captured.onDraftToComposer).toBe(draftToMainComposer);
  });

  it('posts the draft to the bus when a receiver is attached', () => {
    useComposerDraftBus.setState({ attached: true });
    render(<Body />);

    const ok = mocks.captured.onDraftToComposer?.('please fix X');

    expect(ok).toBe(true);
    expect(useComposerDraftBus.getState().draft).toEqual({ text: 'please fix X' });
  });

  it('reports failure (so the caller skips its toast) when no composer is listening', () => {
    render(<Body />);

    const ok = mocks.captured.onDraftToComposer?.('please fix X');

    expect(ok).toBe(false);
    expect(useComposerDraftBus.getState().draft).toBeNull();
  });
});
