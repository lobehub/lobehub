import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HomeEditorInput from './EditorInput';

const getBusinessChatInputSendAreaPrefix = vi.fn(() => <div data-testid="aico-billing-switcher" />);

vi.mock('@/business/client/hooks/useBusinessChatInputSendAreaPrefix', () => ({
  getBusinessChatInputSendAreaPrefix: (...args: unknown[]) =>
    getBusinessChatInputSendAreaPrefix(...args),
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
});
