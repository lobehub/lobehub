import { type ReactNode } from 'react';

// Props a builtin tool's approval / interaction card receives from its host.

export interface BuiltinInterventionProps<Arguments = any> {
  /**
   * When present, a custom intervention should portal its action footer
   * (submit / skip + status) into this node so it stays pinned below the
   * scrollable content instead of scrolling with it. Hosts that render a fixed
   * footer (e.g. the global approval card) supply this; when absent the
   * component renders its footer inline.
   */
  actionsPortalTarget?: HTMLElement | null;
  apiName?: string;
  args: Arguments;
  /** Keep the form visible but inert while a remote resolution awaits producer ACK. */
  disabled?: boolean;
  identifier?: string;
  interactionMode?: 'approval' | 'custom';
  messageId: string;
  /**
   * Hold the host's approve action while the intervention cannot show what is
   * being approved — e.g. its review data is still loading or failed to load.
   * Pass `true` to block approval and `false` to release it; reject / stop stay
   * available. Hosts without approval controls ignore it. Only approval-mode
   * interventions receive it.
   */
  onApprovalBlockedChange?: (blocked: boolean) => void;
  /**
   * Callback to update the arguments before approval
   * This is called when the user modifies the intervention content
   * The approve action will wait for this async callback to complete
   */
  onArgsChange?: (args: Arguments) => void | Promise<void>;
  onInteractionAction?: (
    action:
      | { type: 'submit'; payload: Record<string, unknown> }
      | { type: 'skip'; payload?: Record<string, unknown>; reason?: string }
      | { type: 'cancel'; payload?: Record<string, unknown> },
  ) => Promise<void>;
  /**
   * Register a callback to be called before approval
   * Used by intervention components that need to flush pending saves (e.g., debounced saves)
   * before the approve action proceeds
   * @param id - Unique identifier for the callback (for reliable cleanup)
   * @param callback - The callback to execute before approval
   * @returns Cleanup function to unregister the callback
   */
  registerBeforeApprove?: (id: string, callback: () => void | Promise<void>) => () => void;
  /**
   * Offer an "approve, and stop asking for calls like this" choice beside the
   * plain approve. The host lists it among the approval choices with `label`,
   * and runs `onRemember` right before approving when the user picks it; a
   * plain approve or a rejection never runs it. Only approval-mode
   * interventions receive it.
   * @returns Cleanup function that withdraws the choice
   */
  registerRememberApproval?: (option: BuiltinRememberApproval) => () => void;
}

/** A tool-specific "approve and remember" choice (see `registerRememberApproval`). */
export interface BuiltinRememberApproval {
  label: string;
  onRemember: () => void | Promise<void>;
}

export type BuiltinIntervention = (props: BuiltinInterventionProps) => ReactNode;
