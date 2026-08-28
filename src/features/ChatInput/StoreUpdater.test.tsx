import { type MenuProps } from '@lobehub/ui';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type PropsWithChildren, useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSingleton } from '@/hooks/useSingleton';

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

interface TestHarnessProps {
  onSendMenuChange: (menu: MenuProps | undefined) => void;
  sendMenu?: MenuProps;
}

const Probe = ({
  onSendMenuChange,
}: {
  onSendMenuChange: TestHarnessProps['onSendMenuChange'];
}) => {
  const sendMenu = useChatInputStore((s) => s.sendMenu);

  useEffect(() => {
    onSendMenuChange(sendMenu);
  }, [onSendMenuChange, sendMenu]);

  return null;
};

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
  it('clears sendMenu when the prop becomes undefined', () => {
    const initialSendMenu = { items: [{ key: 'test', label: 'Test' }] } satisfies MenuProps;
    const onSendMenuChange = vi.fn();

    const { rerender } = render(
      <TestHarness>
        <StoreUpdater
          leftActions={[]}
          rightActions={[]}
          sendMenu={initialSendMenu}
          onSend={() => {}}
        />
        <Probe onSendMenuChange={onSendMenuChange} />
      </TestHarness>,
    );

    expect(onSendMenuChange).toHaveBeenLastCalledWith(initialSendMenu);

    rerender(
      <TestHarness>
        <StoreUpdater leftActions={[]} rightActions={[]} sendMenu={undefined} onSend={() => {}} />
        <Probe onSendMenuChange={onSendMenuChange} />
      </TestHarness>,
    );

    expect(onSendMenuChange).toHaveBeenLastCalledWith(undefined);
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
