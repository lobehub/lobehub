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
const TOPIC = 'topic-1';
const OTHER_TOPIC = 'topic-2';

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
      chips: [{ label: 'x', message: 'x' }],
      messageId: MSG,
      status: 'loading',
      topicId: TOPIC,
    });
    const { container } = render(<FollowUpChips messageId={MSG} topicId={TOPIC} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when messageId mismatches and is not a child id', () => {
    useFollowUpActionStore.setState({
      chips: [{ label: 'x', message: 'x' }],
      messageId: OTHER_MSG,
      status: 'ready',
      topicId: TOPIC,
    });
    const { container } = render(<FollowUpChips messageId={MSG} topicId={TOPIC} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when topicId mismatches', () => {
    useFollowUpActionStore.setState({
      chips: [{ label: 'a', message: 'a' }],
      messageId: MSG,
      status: 'ready',
      topicId: TOPIC,
    });
    const { container } = render(<FollowUpChips messageId={MSG} topicId={OTHER_TOPIC} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while the bound message is generating', () => {
    isGeneratingMock = true;
    useFollowUpActionStore.setState({
      chips: [{ label: 'a', message: 'a' }],
      messageId: MSG,
      status: 'ready',
      topicId: TOPIC,
    });
    const { container } = render(<FollowUpChips messageId={MSG} topicId={TOPIC} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one button per chip when both ids match and not generating', () => {
    useFollowUpActionStore.setState({
      chips: [
        { label: 'a', message: 'a' },
        { label: 'b', message: 'b' },
        { label: 'c', message: 'c' },
      ],
      messageId: MSG,
      status: 'ready',
      topicId: TOPIC,
    });
    render(<FollowUpChips messageId={MSG} topicId={TOPIC} />);
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('renders chips when the stored messageId matches a child block id of the bound group', () => {
    displayMessagesMock = [{ children: [{ id: CHILD_MSG }], id: MSG }];
    useFollowUpActionStore.setState({
      chips: [{ label: 'a', message: 'a' }],
      messageId: CHILD_MSG,
      status: 'ready',
      topicId: TOPIC,
    });
    render(<FollowUpChips messageId={MSG} topicId={TOPIC} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('fills the input and consumes on click instead of sending', () => {
    useFollowUpActionStore.setState({
      chips: [{ label: 'go', message: 'go ahead' }],
      messageId: MSG,
      status: 'ready',
      topicId: TOPIC,
    });
    render(<FollowUpChips messageId={MSG} topicId={TOPIC} />);
    fireEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(updateInputMessageMock).toHaveBeenCalledWith('go ahead');
    expect(editorSetDocumentMock).toHaveBeenCalledWith('text', 'go ahead');
    expect(editorFocusMock).toHaveBeenCalled();
    // consume() resets state to idle:
    expect(useFollowUpActionStore.getState().status).toBe('idle');
  });
});
