import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFollowUpActionStore } from '@/store/followUpAction';

import FollowUpChips from './FollowUpChips';

vi.hoisted(() => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
});

const MSG = 'msg-1';
const OTHER_MSG = 'msg-2';
const CHILD_MSG = 'msg-1-child-answer';
const KEY = 'main_agent-a_topic-1';
const OTHER_KEY = 'main_agent-a_topic-2';

const updateInputMessageMock = vi.fn();
const editorSetDocumentMock = vi.fn();
const editorFocusMock = vi.fn();
const editorMock = { focus: editorFocusMock, setDocument: editorSetDocumentMock };
let isGeneratingMock = false;
let displayMessagesMock: Array<{ children?: Array<{ id: string }>; id: string }> = [];

vi.mock('@/features/Conversation', () => ({
  useConversationStore: (selector: any) =>
    selector({
      displayMessages: displayMessagesMock,
      editor: editorMock,
      operationState: {
        getMessageOperationState: () => ({ isGenerating: isGeneratingMock }),
      },
      updateInputMessage: updateInputMessageMock,
    }),
}));

describe('<FollowUpChips />', () => {
  beforeEach(() => {
    updateInputMessageMock.mockReset();
    editorSetDocumentMock.mockReset();
    editorFocusMock.mockReset();
    isGeneratingMock = false;
    displayMessagesMock = [{ id: MSG }];
    useFollowUpActionStore.getState().reset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when status is not ready', () => {
    useFollowUpActionStore.setState({
      slots: {
        [KEY]: {
          chips: [{ label: 'x', message: 'x' }],
          messageId: MSG,
          status: 'loading',
        },
      },
    });
    const { container } = render(<FollowUpChips conversationKey={KEY} messageId={MSG} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when messageId mismatches and is not a child id', () => {
    useFollowUpActionStore.setState({
      slots: {
        [KEY]: {
          chips: [{ label: 'x', message: 'x' }],
          messageId: OTHER_MSG,
          status: 'ready',
        },
      },
    });
    const { container } = render(<FollowUpChips conversationKey={KEY} messageId={MSG} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when conversationKey mismatches', () => {
    useFollowUpActionStore.setState({
      slots: {
        [KEY]: {
          chips: [{ label: 'a', message: 'a' }],
          messageId: MSG,
          status: 'ready',
        },
      },
    });
    const { container } = render(<FollowUpChips conversationKey={OTHER_KEY} messageId={MSG} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while the bound message is generating', () => {
    isGeneratingMock = true;
    useFollowUpActionStore.setState({
      slots: {
        [KEY]: {
          chips: [{ label: 'a', message: 'a' }],
          messageId: MSG,
          status: 'ready',
        },
      },
    });
    const { container } = render(<FollowUpChips conversationKey={KEY} messageId={MSG} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one button per chip when both ids match and not generating', () => {
    useFollowUpActionStore.setState({
      slots: {
        [KEY]: {
          chips: [
            { label: 'a', message: 'a' },
            { label: 'b', message: 'b' },
            { label: 'c', message: 'c' },
          ],
          messageId: MSG,
          status: 'ready',
        },
      },
    });
    render(<FollowUpChips conversationKey={KEY} messageId={MSG} />);
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('renders chips when the stored messageId matches a child block id of the bound group', () => {
    displayMessagesMock = [{ children: [{ id: CHILD_MSG }], id: MSG }];
    useFollowUpActionStore.setState({
      slots: {
        [KEY]: {
          chips: [{ label: 'a', message: 'a' }],
          messageId: CHILD_MSG,
          status: 'ready',
        },
      },
    });
    render(<FollowUpChips conversationKey={KEY} messageId={MSG} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('fills the input and consumes on click instead of sending', () => {
    useFollowUpActionStore.setState({
      slots: {
        [KEY]: {
          chips: [{ label: 'go', message: 'go ahead' }],
          messageId: MSG,
          status: 'ready',
        },
      },
    });
    render(<FollowUpChips conversationKey={KEY} messageId={MSG} />);
    fireEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(updateInputMessageMock).toHaveBeenCalledWith('go ahead');
    expect(editorSetDocumentMock).toHaveBeenCalledWith('text', 'go ahead');
    expect(editorFocusMock).toHaveBeenCalled();
    expect(useFollowUpActionStore.getState().slots[KEY]?.status).toBe('ready');
  });
});
