// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CodexApprovalIntervention } from './ApprovalIntervention';
import type { CodexFileChangeArgs, CodexFileChangeState } from './utils';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  SplitButton: () => null,
}));
// NOTICE:
// The approval tests inspect which original changes reach the existing diff renderer.
// PatchDiff requires browser workers unavailable to this component test environment.
// Source: ./FileChangeRender.tsx uses @lobehub/ui PatchDiff.
// Remove this mock when the component test environment supports those workers.
vi.mock('./FileChangeRender', async () => {
  const { getFileChangeData } = await import('./utils');
  return {
    default: ({
      args,
      pluginState,
    }: {
      args: CodexFileChangeArgs;
      pluginState?: CodexFileChangeState;
    }) => <pre>{JSON.stringify(getFileChangeData(args, pluginState))}</pre>,
  };
});

afterEach(cleanup);

/** @example A person can inspect the exact scope before submitting native permission. */
describe('CodexApprovalIntervention', () => {
  // ROOT CAUSE:
  // A button labelled Deny submitted cancel for legacy command/file requests,
  // aborting the native turn. The same UI action must now submit decline.
  /** @example Both legacy request kinds use operation denial at the UI callback boundary. */
  it.each(['command_execution', 'file_change'])(
    'submits decline when denying a legacy %s request',
    (apiName) => {
      const onInteractionAction = vi.fn();
      render(
        <CodexApprovalIntervention
          apiName={apiName}
          args={{}}
          identifier="codex"
          messageId="message"
          onInteractionAction={onInteractionAction}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'builtins.codex.approval.deny' }));
      /** @example Denying a command or file change does not ask Codex to cancel its turn. */
      expect(onInteractionAction).toHaveBeenCalledWith({
        type: 'submit',
        payload: { decision: 'decline' },
      });
    },
  );

  // ROOT CAUSE:
  // The pending tool hides its normal detail panel, while the old approval card
  // rendered only reason and buttons. Render native command and authorization
  // scope in the card, keeping original file changes separate from approval args.
  /** @example Command, working directory, destination, and persistent prefix stay visible. */
  it('shows the complete command approval scope', () => {
    render(
      <CodexApprovalIntervention
        apiName="command_execution"
        identifier="codex"
        messageId="message"
        args={{
          availableDecisions: ['accept', 'cancel'],
          command: 'curl https://example.com',
          cwd: '/workspace/project',
          networkApprovalContext: { host: 'example.com', protocol: 'https' },
          proposedExecpolicyAmendment: ['curl', '--head'],
          reason: 'Fetch metadata',
        }}
      />,
    );
    /** @example The full command appears without depending on collapsed tool details. */
    expect(screen.getByText('curl https://example.com')).toBeTruthy();
    /** @example The user sees where the command will execute. */
    expect(screen.getByText('/workspace/project')).toBeTruthy();
    /** @example The network permission identifies its destination and protocol. */
    expect(screen.getByText(/example\.com.*https/)).toBeTruthy();
    /** @example Persistent command scope preserves argument boundaries. */
    expect(screen.getByText('["curl","--head"]')).toBeTruthy();
  });

  /** @example File approval keeps the original diff and directory grant visible. */
  it('renders original file changes beside the requested session scope', () => {
    render(
      <CodexApprovalIntervention
        apiName="file_change"
        args={{ availableDecisions: ['accept', 'cancel'], grantRoot: '/workspace/project' }}
        identifier="codex"
        messageId="message"
        toolArgs={{ changes: [{ path: 'config.ts', diffText: '+export const enabled = true;' }] }}
      />,
    );
    /** @example The requested write grant is visible before accepting it. */
    expect(screen.getByText('/workspace/project')).toBeTruthy();
    /** @example The diff renderer receives the original proposal. */
    expect(screen.getByText(/export const enabled = true/)).toBeTruthy();
  });

  // ROOT CAUSE:
  // item/fileChange/patchUpdated replaces the proposal in pluginState after item/started.
  // Rendering only toolArgs showed the original patch while approving the updated write.
  /** @example A pending approval tracks the latest streamed proposal without retaining stale changes. */
  it('updates the displayed file proposal when live patch state changes', () => {
    const props = {
      apiName: 'file_change',
      args: {},
      identifier: 'codex',
      messageId: 'message',
      toolArgs: { changes: [{ path: 'config.ts', diffText: '+const original = true;' }] },
    };
    const { rerender } = render(<CodexApprovalIntervention {...props} />);
    /** @example The original proposal is shown before any patch update arrives. */
    expect(screen.getByText(/const original = true/)).toBeTruthy();
    rerender(
      <CodexApprovalIntervention
        {...props}
        pluginState={{ changes: [{ path: 'config.ts', diffText: '+const latest = true;' }] }}
      />,
    );
    /** @example Approval displays the currently pending write. */
    expect(screen.getByText(/const latest = true/)).toBeTruthy();
    /** @example Superseded source is no longer offered for review. */
    expect(screen.queryByText(/const original = true/)).toBeNull();
  });

  /** @example A patch arriving after an empty start still has an inspectable approval. */
  it('renders streamed file changes when original tool arguments are absent', () => {
    render(
      <CodexApprovalIntervention
        apiName="file_change"
        args={{}}
        identifier="codex"
        messageId="message"
        pluginState={{
          changes: [{ path: 'created.ts', diffText: '+export const created = true;' }],
        }}
      />,
    );
    /** @example The streamed patch is visible before the user can allow it. */
    expect(screen.getByText(/export const created = true/)).toBeTruthy();
  });

  /** @example An inactive callback cannot submit permission. */
  it('disables decisions and does not submit when disabled', () => {
    const onInteractionAction = vi.fn();
    render(
      <CodexApprovalIntervention
        disabled
        apiName="command_execution"
        args={{ availableDecisions: ['accept', 'cancel'] }}
        identifier="codex"
        messageId="message"
        onInteractionAction={onInteractionAction}
      />,
    );
    const button = screen.getByRole('button', { name: 'builtins.codex.approval.accept' });
    fireEvent.click(button);
    /** @example An inactive approval is visibly disabled. */
    expect(button.hasAttribute('disabled')).toBe(true);
    /** @example A disabled click never crosses the callback boundary. */
    expect(onInteractionAction).not.toHaveBeenCalled();
  });
});
