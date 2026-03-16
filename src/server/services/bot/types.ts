// --------------- Platform Messenger ---------------

export interface PlatformMessenger {
  createMessage: (content: string) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  removeReaction: (messageId: string, emoji: string) => Promise<void>;
  triggerTyping: () => Promise<void>;
  updateThreadName?: (name: string) => Promise<void>;
}

// --------------- Platform Bot (lifecycle) ---------------

export interface PlatformBot {
  readonly applicationId: string;
  readonly platform: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export type PlatformBotClass = (new (config: any) => PlatformBot) & {
  /** Whether instances require a persistent connection (e.g. WebSocket). */
  persistent?: boolean;
};

// --------------- Platform Descriptor ---------------

/**
 * Encapsulates all platform-specific behavior.
 *
 * Adding a new bot platform only requires:
 * 1. Create a new file in `platforms/` implementing a descriptor + PlatformBot class.
 * 2. Register in `platforms/index.ts`.
 *
 * No switch statements or conditionals needed in BotMessageRouter, BotCallbackService,
 * or AgentBridgeService.
 */
export interface PlatformDescriptor {
  /** Maximum characters per message. Undefined = use default (1800). */
  charLimit?: number;

  /** Create a Chat SDK adapter config object keyed by adapter name. */
  createAdapter: (
    credentials: Record<string, string>,
    applicationId: string,
  ) => Record<string, any>;

  /** Create a PlatformMessenger for sending/editing messages via REST API. */
  createMessenger: (
    credentials: Record<string, string>,
    platformThreadId: string,
  ) => PlatformMessenger;

  /** Extract the chat/channel ID from a composite platformThreadId. */
  extractChatId: (platformThreadId: string) => string;

  // ---------- Thread/Message ID parsing ----------

  /**
   * Whether to register onNewMessage handler for direct messages.
   * Telegram & Lark need this; Discord does not (would cause unsolicited replies).
   */
  handleDirectMessages: boolean;

  /**
   * Called after a bot is registered in BotMessageRouter.loadAgentBots().
   * Discord: indexes bot by token for gateway forwarding.
   * Telegram: calls setWebhook API.
   */
  onBotRegistered?: (context: {
    applicationId: string;
    credentials: Record<string, string>;
    registerByToken?: (token: string) => void;
  }) => Promise<void>;

  // ---------- Credential validation ----------

  /** Parse a composite message ID into the platform-native format. */
  parseMessageId: (compositeId: string) => string | number;

  // ---------- Factories ----------

  /** Whether the platform uses persistent connections (WebSocket/Gateway). */
  persistent: boolean;

  /** Platform identifier (e.g., 'discord', 'telegram', 'lark'). */
  platform: string;

  // ---------- Lifecycle hooks ----------

  /** Required credential field names for this platform. */
  requiredCredentials: string[];
}
