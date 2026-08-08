import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HomeEditorInput from './EditorInput';

const getBusinessChatInputSendAreaPrefix = vi.fn(() => <div data-testid="aico-billing-switcher" />);
const useBusinessChatInputAlerts = vi.fn(() => <div data-testid="aico-funds-blocked-alert" />);

vi.mock('@/business/client/hooks/useBusinessChatInputSendAreaPrefix', () => ({
  getBusinessChatInputSendAreaPrefix: (...args: unknown[]) =>
    getBusinessChatInputSendAreaPrefix(...args),
  useBusinessChatInputAlerts: () => useBusinessChatInputAlerts(),
  useBusinessChatInputSendDisabled: () => false,
}));

vi.mock('@/features/AicoBilling', () => ({
  useFundsBlockedComposerCue: () => ({
    blocked: false,
    onMarkdownContentChange: (onChange: (content: string) => void) => onChange,
  }),
}));

vi.mock('@/features/ChatInput/ActionBar', () => ({
  default: () => <div data-testid="action-bar" />,
}));

vi.mock('@/features/ChatInput', () => ({
  ChatInputProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DesktopChatInput: ({ sendAreaPrefix }: { sendAreaPrefix?: React.ReactNode }) => (
    <div data-testid="desktop-chat-input">{sendAreaPrefix}</div>
  ),
}));

vi.mock('./ModeSelect', () => ({
  default: () => <div data-testid="mode-select" />,
}));

vi.mock('@/store/chat', () => ({
  useChatStore: { setState: vi.fn() },
}));

describe('HomeEditorInput billing switcher', () => {
  beforeEach(() => {
    getBusinessChatInputSendAreaPrefix.mockClear();
    useBusinessChatInputAlerts.mockClear();
  });

  it('exposes the billing source switcher before the first message', () => {
    render(
      <HomeEditorInput
        initialValue=""
        isAgentConfigLoading={false}
        loading={false}
        mode="chat"
        send={async () => {}}
        onModeChange={() => {}}
        onValueChange={() => {}}
      />,
    );

    expect(getBusinessChatInputSendAreaPrefix).toHaveBeenCalled();
    expect(screen.getByTestId('aico-billing-switcher')).toBeInTheDocument();
  });

  it('mounts funds-blocked alerts above the composer (Conversation parity)', () => {
    render(
      <HomeEditorInput
        initialValue=""
        isAgentConfigLoading={false}
        loading={false}
        mode="chat"
        send={async () => {}}
        onModeChange={() => {}}
        onValueChange={() => {}}
      />,
    );

    expect(useBusinessChatInputAlerts).toHaveBeenCalled();
    expect(screen.getByTestId('aico-funds-blocked-alert')).toBeInTheDocument();
  });
});
