import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type PropsWithChildren, useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getConversationSendButtonProps } from '@/features/Conversation/ChatInput/utils';
import { useSingleton } from '@/hooks/useSingleton';

import SendButton from './SendArea/SendButton';
import { createStore, Provider, useChatInputStore } from './store';
import StoreUpdater from './StoreUpdater';
import VoiceMessage from './VoiceMessage';

const voiceCapability = vi.hoisted(() => ({ fallback: false }));
const voiceRecorder = vi.hoisted(() => ({
  durationMs: 0,
  error: undefined,
  minDurationMs: 500,
  recording: undefined,
  reset: vi.fn(),
  start: vi.fn(),
  status: 'idle' as 'idle' | 'recording',
  stop: vi.fn(),
  waveform: [],
}));

vi.mock('./ActionBar/components/ChatInputAction', () => ({
  ChatInputAction: ({
    disabled,
    'data-testid': testId,
    onClick,
  }: {
    'data-testid'?: string;
    'disabled'?: boolean;
    'onClick'?: () => void;
  }) => <button data-testid={testId} disabled={disabled} type="button" onClick={onClick} />,
}));

vi.mock('./VoiceMessage/useVoiceMessageCapability', async (importOriginal) => ({
  ...(await importOriginal()),
  useVoiceMessageCapability: () => voiceCapability.fallback,
}));

vi.mock('./VoiceMessage/useVoiceMessageRecorder', () => ({
  useVoiceMessageRecorder: () => voiceRecorder,
}));

const VoiceCapabilityProbe = ({ onChange }: { onChange: (value?: boolean) => void }) => {
  const canRecordVoiceMessage = useChatInputStore((s) => s.canRecordVoiceMessage);

  useEffect(() => {
    onChange(canRecordVoiceMessage);
  }, [canRecordVoiceMessage, onChange]);

  return null;
};

const TestHarness = ({ children }: PropsWithChildren) => {
  const store = useSingleton(createStore);

  return <Provider createStore={() => store}>{children}</Provider>;
};

beforeEach(() => {
  voiceRecorder.status = 'idle';
  voiceRecorder.reset.mockReset();
  voiceRecorder.start.mockReset();
  voiceRecorder.stop.mockReset();
});

describe('ChatInput StoreUpdater', () => {
  it('shows a queued follow-up as a loading Send beside a static Stop', () => {
    const onStop = vi.fn();
    const send = vi.fn();
    const store = createStore();
    store.setState({ handleSendButton: send, handleStop: onStop });
    render(
      <Provider createStore={() => store}>
        <StoreUpdater
          leftActions={[]}
          rightActions={[]}
          sendButtonProps={getConversationSendButtonProps(
            { disabled: false, generating: true, onStop, showSendWhileGenerating: true },
            { shape: 'round' },
          )}
        />
        <SendButton />
      </Provider>,
    );

    act(() => store.setState({ uploadQueuedSend: { draftKey: undefined, unsubscribe: vi.fn() } }));
    const stopButton = screen.getByTestId('chat-input-stop');
    const sendButton = screen.getByTestId('chat-input-send-pending');

    // Stop draws its square only — no spinning arc around it.
    expect(stopButton.querySelectorAll('svg')).toHaveLength(1);
    expect(stopButton.querySelector('circle')).toBeNull();
    expect(stopButton).not.toBeDisabled();
    expect(sendButton).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(sendButton);
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(stopButton);
    expect(onStop).toHaveBeenCalledOnce();

    act(() => store.setState({ uploadQueuedSend: undefined }));
    expect(screen.queryByTestId('chat-input-send-pending')).toBeNull();
    const [, restoredSend] = screen.getAllByRole('button');
    expect(restoredSend).not.toBeDisabled();
    fireEvent.click(restoredSend);
    expect(send).toHaveBeenCalledOnce();
  });

  it('drops a send queued for uploads as soon as the conversation switches', () => {
    const store = createStore();
    const renderAt = (draftKey: string) => (
      <Provider createStore={() => store}>
        <StoreUpdater draftKey={draftKey} leftActions={[]} rightActions={[]} />
      </Provider>
    );
    const { rerender } = render(renderAt('tpc_a'));
    const unsubscribe = vi.fn();
    act(() => store.setState({ uploadQueuedSend: { draftKey: 'tpc_a', unsubscribe } }));

    rerender(renderAt('tpc_b'));
    // Coming back before the uploads settle must not revive it.
    rerender(renderAt('tpc_a'));

    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(store.getState().uploadQueuedSend).toBeUndefined();
  });

  it('shows Send as loading instead of Stop while the sent message is being created', () => {
    const store = createStore();
    render(
      <Provider createStore={() => store}>
        <StoreUpdater
          leftActions={[]}
          rightActions={[]}
          sendButtonProps={{ generating: false, loading: true, onStop: vi.fn() }}
        />
        <SendButton />
      </Provider>,
    );

    expect(screen.queryByTestId('chat-input-stop')).toBeNull();
    expect(screen.getByTestId('chat-input-send-pending')).toHaveAttribute('aria-busy', 'true');
  });

  it('keeps canRecordVoiceMessage in sync when the prop changes', () => {
    const onChange = vi.fn();

    const { rerender } = render(
      <TestHarness>
        <StoreUpdater
          canRecordVoiceMessage={false}
          leftActions={[]}
          rightActions={[]}
          onSend={() => {}}
        />
        <VoiceCapabilityProbe onChange={onChange} />
      </TestHarness>,
    );

    expect(onChange).toHaveBeenLastCalledWith(false);

    rerender(
      <TestHarness>
        <StoreUpdater canRecordVoiceMessage leftActions={[]} rightActions={[]} onSend={() => {}} />
        <VoiceCapabilityProbe onChange={onChange} />
      </TestHarness>,
    );

    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it('lets an injected capability override the fallback model capability', () => {
    const store = createStore({
      agentId: 'voice-agent',
      canRecordVoiceMessage: true,
      leftActions: [],
      onVoiceMessageSend: () => true,
      rightActions: [],
    });

    render(
      <Provider createStore={() => store}>
        <VoiceMessage />
      </Provider>,
    );

    expect(voiceCapability.fallback).toBe(false);
    expect(screen.getByTestId('voice-message-action')).not.toBeDisabled();
  });

  it('blocks a second voice recording while the current response is generating', () => {
    const onStop = vi.fn();
    const store = createStore({
      agentId: 'voice-agent',
      canRecordVoiceMessage: true,
      leftActions: [],
      onVoiceMessageSend: () => true,
      rightActions: [],
      sendButtonProps: { generating: true, onStop },
    });

    render(
      <Provider createStore={() => store}>
        <VoiceMessage />
      </Provider>,
    );

    const action = screen.getByTestId('voice-message-action');
    expect(action).toBeDisabled();
    fireEvent.click(action);
    expect(voiceRecorder.start).not.toHaveBeenCalled();

    act(() => store.setState({ sendButtonProps: { generating: false, onStop } }));

    const restoredAction = screen.getByTestId('voice-message-action');
    expect(restoredAction).not.toBeDisabled();
    fireEvent.click(restoredAction);
    expect(voiceRecorder.start).toHaveBeenCalledOnce();
  });

  it('cancels an active recording when a response starts generating', async () => {
    voiceRecorder.status = 'recording';
    voiceRecorder.reset.mockImplementation(() => {
      voiceRecorder.status = 'idle';
    });
    const onStop = vi.fn();
    const store = createStore({
      activeAudioInputMode: 'voiceMessage',
      agentId: 'voice-agent',
      canRecordVoiceMessage: true,
      leftActions: [],
      onVoiceMessageSend: () => true,
      rightActions: [],
      sendButtonProps: { generating: false, onStop },
    });

    render(
      <Provider createStore={() => store}>
        <VoiceMessage />
      </Provider>,
    );

    act(() => store.setState({ sendButtonProps: { generating: true, onStop } }));

    await waitFor(() => expect(voiceRecorder.reset).toHaveBeenCalledOnce());
    expect(store.getState().activeAudioInputMode).toBeUndefined();
  });
});
