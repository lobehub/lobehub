import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import Body from './Body';

const mocks = vi.hoisted(() => ({
  acceptanceId: undefined as string | undefined,
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/chat/selectors', () => ({
  chatPortalSelectors: {
    acceptancePortalId: () => 'acc-1',
  },
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

vi.mock('@/features/Acceptance', () => ({
  AcceptanceViewer: (props: { acceptanceId?: string }) => {
    mocks.acceptanceId = props.acceptanceId;
    return null;
  },
  OriginConversationProvider: ({ children }: { children?: React.ReactNode }) => children,
}));

vi.mock('@/features/Acceptance/Viewer/TopicPanel', () => ({ default: () => null }));

describe('Portal Acceptance Body', () => {
  it('renders outside ConversationProvider without touching the context store', () => {
    expect(() => render(<Body />)).not.toThrow();
    expect(mocks.acceptanceId).toBe('acc-1');
  });
});
