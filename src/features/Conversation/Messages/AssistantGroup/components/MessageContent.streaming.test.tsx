/**
 * @vitest-environment happy-dom
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import MessageContent from './MessageContent';

let mockStoreContent = '';
const markdownProps: { animated?: boolean; enableStream?: boolean }[] = [];

vi.mock('@/features/Conversation/Markdown', () => ({
  default: (props: { animated?: boolean; enableStream?: boolean }) => {
    markdownProps.push(props);
    return null;
  },
}));

vi.mock('@/components/HtmlPreview', () => ({ HtmlPreviewDrawer: () => null }));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: any) => selector({ settings: {} }),
}));

vi.mock('@/store/user/selectors', () => ({
  userGeneralSettingsSelectors: { config: () => ({ transitionMode: 'fadeIn' }) },
}));

vi.mock('../../../store', () => ({
  dataSelectors: {
    getBlockContent: () => () => mockStoreContent,
    getBlockHasTools: () => () => false,
    getBlockMetadata: () => () => undefined,
    getDbMessageById: () => () => ({ createdAt: 1000 }),
  },
  messageStateSelectors: { isAssistantGroupItemGenerating: () => () => true },
  useConversationStore: (selector: (state: unknown) => unknown) => selector({}),
}));

describe('MessageContent streaming across remounts', () => {
  afterEach(() => {
    cleanup();
    markdownProps.length = 0;
  });

  it('keeps fading in a reply that remounts mid-stream and keeps growing', () => {
    // The post-tool reply first renders inside the workflow fold as a status line…
    mockStoreContent = 'Let me summarize.';
    render(<MessageContent id="post-tool-answer" />).unmount();

    // …then grows into an answer and remounts outside the fold.
    mockStoreContent = 'Let me summarize.\n\n## Findings';
    render(<MessageContent id="post-tool-answer" />);

    expect(markdownProps.at(-1)).toMatchObject({ animated: true, enableStream: true });
  });

  it('does not replay the fade when the reply remounts without new text', () => {
    mockStoreContent = 'A finished reply.';
    render(<MessageContent id="finished-answer" />).unmount();
    render(<MessageContent id="finished-answer" />);

    expect(markdownProps.at(-1)).toMatchObject({ animated: false, enableStream: false });
  });
});
