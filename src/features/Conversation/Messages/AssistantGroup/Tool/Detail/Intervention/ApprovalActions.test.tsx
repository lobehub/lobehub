/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ApprovalActions from './ApprovalActions';

const { approveToolCall, approveToolCallAndCovered, rejectAndContinueToolCall, stop } = vi.hoisted(
  () => ({
    approveToolCall: vi.fn(),
    approveToolCallAndCovered: vi.fn(),
    rejectAndContinueToolCall: vi.fn(),
    stop: vi.fn(),
  }),
);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));

vi.mock('@lobechat/shared-tool-ui/pending-hotkeys', () => ({
  registerPendingHotkeyCard: () => () => {},
}));

vi.mock('@/store/chat/slices/agentRun/actions/transports/client/interventionAudits', () => ({
  clientInterventionAudits: {},
}));

vi.mock('@/store/tool', () => ({
  useToolStore: () => undefined,
}));

vi.mock('@/store/tool/selectors', () => ({
  toolSelectors: { getManifestById: () => () => undefined },
}));

vi.mock('@/store/user', () => ({
  useUserStore: () => vi.fn(),
}));

vi.mock('../../../../../hooks/useConversationResourceAccess', () => ({
  useConversationResourceAccess: () => ({ canUseResource: true }),
}));

vi.mock('../../../../../store', () => ({
  useConversationStore: (selector: (state: unknown) => unknown) =>
    selector({
      approveToolCall,
      approveToolCallAndCovered,
      context: {},
      rejectAndContinueToolCall,
      stopPendingApprovalForCard: stop,
    }),
}));

const renderCard = (props: Partial<Parameters<typeof ApprovalActions>[0]> = {}) =>
  render(
    <ApprovalActions
      apiName="runCommand"
      approvalMode="manual"
      assistantGroupId="group-1"
      identifier="lobe-local-system"
      messageId="tool-msg-1"
      toolArgs={{ command: 'ls' }}
      toolCallId="call-1"
      {...props}
    />,
  );

describe('ApprovalActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // T-2809: `approve` starts highlighted, so clicking it used to change
  // nothing — the user believed they had approved while the run kept waiting.
  it('approves the call when the already-highlighted approve row is clicked', async () => {
    renderCard();

    const approveRow = screen
      .getByText('tool.intervention.optionApprove')
      .closest('[role="radio"]');
    expect(approveRow?.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(approveRow!);

    await waitFor(() => {
      expect(approveToolCall).toHaveBeenCalledWith('tool-msg-1', 'group-1', {
        editedArguments: undefined,
      });
    });
    expect(stop).not.toHaveBeenCalled();
    expect(rejectAndContinueToolCall).not.toHaveBeenCalled();
  });

  it('approves and remembers when the remember row is clicked', async () => {
    renderCard();

    fireEvent.click(screen.getByText('tool.intervention.optionApproveRemember'));

    await waitFor(() => {
      expect(approveToolCallAndCovered).toHaveBeenCalledWith(
        'tool-msg-1',
        'group-1',
        expect.objectContaining({ rememberToolKey: 'lobe-local-system/runCommand' }),
      );
    });
    expect(approveToolCall).not.toHaveBeenCalled();
  });

  it('does not approve from a row click while approval is held', async () => {
    renderCard({ approveDisabled: true });

    fireEvent.click(screen.getByText('tool.intervention.optionApprove'));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(approveToolCall).not.toHaveBeenCalled();
  });

  it('only selects the reject row, leaving the reason to be typed and submitted', async () => {
    renderCard();

    const rejectInput = screen.getByPlaceholderText('tool.intervention.rejectReasonPlaceholder');
    fireEvent.click(rejectInput.closest('[role="radio"]')!);
    expect(rejectAndContinueToolCall).not.toHaveBeenCalled();

    fireEvent.change(rejectInput, { target: { value: 'use a dry run' } });
    fireEvent.click(screen.getByText('tool.intervention.submit'));

    await waitFor(() => {
      expect(rejectAndContinueToolCall).toHaveBeenCalledWith('tool-msg-1', 'use a dry run');
    });
    expect(approveToolCall).not.toHaveBeenCalled();
  });
});
