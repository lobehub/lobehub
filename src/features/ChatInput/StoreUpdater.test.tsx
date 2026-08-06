import { type MenuProps } from '@lobehub/ui';
import { render, screen } from '@testing-library/react';
import { type PropsWithChildren, useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useSingleton } from '@/hooks/useSingleton';

import { createStore, Provider, useChatInputStore } from './store';
import StoreUpdater from './StoreUpdater';
import VoiceMessage from './VoiceMessage';

const voiceCapability = vi.hoisted(() => ({ fallback: false }));

vi.mock('./ActionBar/components/ChatInputAction', () => ({
  ChatInputAction: ({
    disabled,
    'data-testid': testId,
  }: {
    'data-testid'?: string;
    'disabled'?: boolean;
  }) => <button data-testid={testId} disabled={disabled} type="button" />,
}));

vi.mock('./VoiceMessage/useVoiceMessageCapability', async (importOriginal) => ({
  ...(await importOriginal()),
  useVoiceMessageCapability: () => voiceCapability.fallback,
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
});
