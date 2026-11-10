export interface InputState {
  /**
   * Measured height of the floating overlay that sits above the ChatInput
   * (TodoProgress + QueueTray). Used by the ChatList scroll container to
   * reserve matching bottom padding so the overlay doesn't cover the
   * latest messages.
   */
  chatInputOverlayHeight: number;

  /**
   * Editor instance (for ChatInput)
   */
  editor: any | null;

  /**
   * Current input message text
   */
  inputMessage: string;

  /**
   * Whether this conversation's composer currently mounts an OpStatusTray.
   * The tray reports a running turn above the input, so the message list can
   * drop its own in-bubble "…is running" lines after earlier output. Surfaces
   * without a composer (goal supervision, channel reply panel, group thread
   * portal) keep those lines as their only running signal.
   */
  opStatusTrayMounted: boolean;

  /**
   * When set, the next send is deferred to this time instead of running now.
   *
   * Picking a time from the composer only *arms* the send — it does not create
   * anything. The send button stays the single commit action, so "pick a time"
   * and "send" don't become two competing ways to dispatch a turn. UTC ISO.
   */
  scheduledSendAt?: string;
}

export const inputInitialState: InputState = {
  chatInputOverlayHeight: 0,
  editor: null,
  inputMessage: '',
  opStatusTrayMounted: false,
  scheduledSendAt: undefined,
};
