export interface BotSleepParams {
  applicationId: string;
  /** When the bot was last used (`agent_bot_providers.last_active_at`). */
  lastActiveAt: Date;
  platform: string;
  /** The bot's creator. */
  userId: string;
  workspaceId?: string;
}

export interface BotSleepState {
  asleep: boolean;
  /** Why the bot is asleep, shown with its runtime status. */
  message?: string;
}

/**
 * Whether a persistent-connection bot should be kept disconnected because it
 * sat idle. Asked by the runtime paths that keep connections alive; webhook
 * bots are never asked. Default: never.
 */
export async function getBotSleepState(_params: BotSleepParams): Promise<BotSleepState> {
  return { asleep: false };
}
