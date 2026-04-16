import type { Chat, Message } from 'chat';

import type { AttachmentSource } from '@/server/services/aiAgent/ingestAttachment';

// ============================================================================
// Bot Platform Core Types
// ============================================================================

/**
 * Extended return type for `extractFiles` that carries optional warnings
 * (e.g. "file too large") alongside extracted files. Warnings are appended
 * to the agent prompt so the AI can inform the user naturally.
 */
export interface ExtractFilesResult {
  files?: AttachmentSource[];
  warnings?: string[];
}

// --------------- Connection Mode ---------------

/**
 * How the platform communicates with the server.
 * - 'webhook': stateless HTTP callbacks (can run in serverless)
 * - 'websocket': persistent WebSocket connection (e.g. Discord, QQ)
 * - 'polling': persistent long-polling connection (e.g. WeChat)
 */
export type ConnectionMode = 'polling' | 'webhook' | 'websocket';

// --------------- Field Schema ---------------

/**
 * Unified field schema for both credentials and settings.
 *
 * Drives:
 * - Server: validation + default value extraction
 * - Frontend: auto-generated form (type → component mapping)
 */
export interface FieldSchema {
  /** Default value */
  default?: unknown;
  description?: string;
  /** Only show in development environment */
  devOnly?: boolean;
  /** Enum options for select fields */
  enum?: string[];
  /** Display labels for enum options */
  enumLabels?: string[];
  /** Array item schema */
  items?: FieldSchema;
  /** Unique field identifier */
  key: string;
  /** Display label */
  label: string;
  maximum?: number;
  minimum?: number;
  placeholder?: string;
  /** Nested fields (for type: 'object') */
  properties?: FieldSchema[];
  required?: boolean;
  /**
   * Field type, maps to UI component:
   * - 'string' → Input
   * - 'password' → Password input
   * - 'number' / 'integer' → NumberInput
   * - 'boolean' → Switch
   * - 'object' → nested group
   * - 'array' → list
   */
  type: 'array' | 'boolean' | 'integer' | 'number' | 'object' | 'password' | 'string';
  /** Conditional visibility: show only when another field matches a value */
  visibleWhen?: { field: string; value: unknown };
}

// --------------- Platform Messenger ---------------

/**
 * LobeHub-specific outbound capabilities used by callback and bridge services.
 */
export interface PlatformMessenger {
  createMessage: (content: string) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  removeReaction: (messageId: string, emoji: string) => Promise<void>;
  triggerTyping?: () => Promise<void>;
  updateThreadName?: (name: string) => Promise<void>;
}

// --------------- Usage Stats ---------------

/**
 * Raw usage statistics for a bot response.
 * Passed to `PlatformClient.formatReply` so each platform can decide
 * whether and how to render usage information.
 */
export interface UsageStats {
  elapsedMs?: number;
  llmCalls?: number;
  toolCalls?: number;
  totalCost: number;
  totalTokens: number;
}

// --------------- Platform Client ---------------

/**
 * A client to a specific platform instance, holding credentials and runtime context.
 *
 * Server services interact with the platform through this interface only.
 * All platform-specific operations are encapsulated here.
 */
export interface PlatformClient {
  readonly applicationId: string;
  /**
   * Apply platform-specific Chat SDK compatibility patches after bot initialization.
   * Useful for adapter quirks that should stay encapsulated within the platform client.
   */
  applyChatPatches?: (chatBot: Chat<any>) => void;

  /** Create a Chat SDK adapter config for inbound message handling. */
  createAdapter: () => Record<string, any>;

  /** Extract the chat/channel ID from a composite platformThreadId. */
  extractChatId: (platformThreadId: string) => string;

  /**
   * Resolve attachments on an inbound `Message` into `AttachmentSource[]` for
   * ingestion by the bridge. Each platform owns its own attachment quirks
   * here: data-source priority, type-only metadata inference, quoted-message
   * handling, and re-download paths for data lost during chat-sdk Redis
   * serialization (functions and buffers don't survive `Message.toJSON`).
   *
   * Optional — when omitted, the bridge falls back to its legacy
   * `extractFiles` implementation. Eventually all platforms will implement
   * this and the bridge fallback will be deleted.
   */
  extractFiles?: (message: Message) => Promise<AttachmentSource[] | ExtractFilesResult | undefined>;

  /**
   * Transform outbound Markdown content into a format the platform can render.
   * Called before `formatReply` and `splitMessage`.
   *
   * Platforms that don't support Markdown (e.g. WeChat, QQ) should strip
   * formatting to plain text. Platforms with native Markdown support can
   * omit this method — the content is passed through as-is.
   */
  formatMarkdown?: (markdown: string) => string;

  /**
   * Format the final outbound reply from body content and optional usage stats.
   * Each platform decides whether to render the stats and how to format them
   * (e.g. Discord uses `-# stats` when the user enables usage display).
   * When not implemented, the caller returns body as-is (no stats).
   */
  formatReply?: (body: string, stats?: UsageStats) => string;

  // --- Runtime Operations ---

  /** Get a messenger for a specific thread (outbound messaging). */
  getMessenger: (platformThreadId: string) => PlatformMessenger;

  readonly id: string;

  /** Parse a composite message ID into the platform-native format. */
  parseMessageId: (compositeId: string) => string | number;

  /**
   * Register bot commands with the platform (e.g., Telegram setMyCommands).
   * Called once during bot initialization with the list of available commands.
   * Optional — platforms that don't support command menus can omit this.
   */
  registerBotCommands?: (
    commands: Array<{ command: string; description: string }>,
  ) => Promise<void>;

  /**
   * Resolve the correct thread ID for reaction API calls.
   *
   * Some platforms (e.g. Discord) need to route reactions to a different channel
   * than the thread itself — for instance, a thread-starter message lives in
   * the parent channel, not in the thread.
   *
   * When not implemented, `threadId` is used as-is.
   */
  resolveReactionThreadId?: (threadId: string, messageId: string) => string;

  /** Strip platform-specific bot mention artifacts from user input. */
  sanitizeUserInput?: (text: string) => string;

  /**
   * Whether the bot should subscribe to a thread. Default: true.
   * Discord: returns false for top-level channels (not threads).
   */
  shouldSubscribe?: (threadId: string) => boolean;

  // --- Lifecycle ---
  start: (options?: any) => Promise<void>;

  stop: () => Promise<void>;
}

// --------------- Provider Config ---------------

/**
 * Represents a concrete bot provider configuration.
 * Corresponds to a row in the `agentBotProviders` table.
 */
export interface BotProviderConfig {
  applicationId: string;
  credentials: Record<string, string>;
  platform: string;
  settings: Record<string, unknown>;
}

// --------------- Runtime Context ---------------

export interface BotPlatformRedisClient {
  del: (key: string) => Promise<number>;
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, options?: { ex?: number }) => Promise<string | null>;
  subscribe?: (channel: string, callback: (message: string) => void) => Promise<void>;
}

export interface BotPlatformRuntimeContext {
  appUrl?: string;
  redisClient?: BotPlatformRedisClient;
  registerByToken?: (token: string) => void;
}

// --------------- Validation ---------------

export interface ValidationResult {
  errors?: Array<{ field: string; message: string }>;
  valid: boolean;
}

// --------------- Platform Documentation ---------------

export interface PlatformDocumentation {
  /** URL to the platform's developer portal / open platform console */
  portalUrl?: string;
  /** URL to the usage documentation (e.g. LobeHub docs for this platform) */
  setupGuideUrl?: string;
}

// --------------- Client Factory ---------------

/**
 * Abstract base class for creating PlatformClient instances.
 *
 * - `createClient` (abstract): instantiate a PlatformClient (e.g. based on connectionMode)
 * - `validateCredentials`: verify credentials against the platform API — called from UI flow only
 * - `validateSettings`: validate platform-specific settings — called from UI flow only
 */
export abstract class ClientFactory {
  /** Create a PlatformClient instance. Fast and sync — no network calls. */
  abstract createClient(
    config: BotProviderConfig,
    context: BotPlatformRuntimeContext,
  ): PlatformClient;

  /**
   * Verify credentials against the platform API.
   * Called explicitly from the UI/API layer when the user saves credentials.
   */
  async validateCredentials(
    _credentials: Record<string, string>,
    _settings?: Record<string, unknown>,
    _applicationId?: string,
    _platform?: string,
  ): Promise<ValidationResult> {
    return { valid: true };
  }

  /**
   * Validate platform-specific settings.
   * Called explicitly from the UI/API layer when the user saves settings.
   */
  async validateSettings(_settings: Record<string, unknown>): Promise<ValidationResult> {
    return { valid: true };
  }
}

// --------------- Platform Definition ---------------

/**
 * A platform definition, uniquely identified by `id`.
 *
 * Contains metadata, factory, and validation. All runtime operations go through PlatformClient.
 */
export interface PlatformDefinition {
  /** Factory for creating PlatformClient instances and validating credentials/settings. */
  clientFactory: ClientFactory;

  /**
   * Connection mode: how the platform communicates with the server.
   * - 'webhook': stateless HTTP callbacks (can run in serverless)
   * - 'websocket': persistent WebSocket connection (e.g. Discord, QQ)
   * - 'polling': persistent long-polling connection (e.g. WeChat)
   *
   * For single-mode platforms this is the runtime mode. For multi-mode
   * platforms where users can pick per-provider via `settings.connectionMode`,
   * this represents the *recommended* default for new providers (form initial
   * value + cron coarse filter).
   *
   * For platforms that added multi-mode support after launch (Slack/Feishu/
   * Lark/QQ), legacy provider rows without an explicit setting fall back to
   * `'webhook'` instead — see `LEGACY_WEBHOOK_PLATFORMS` and
   * `getEffectiveConnectionMode` in `./utils.ts`.
   */
  connectionMode: ConnectionMode;

  /** The description of the platform. */
  description?: string;

  /** Documentation links for the platform */
  documentation?: PlatformDocumentation;

  /** The unique identifier of the platform. */
  id: string;

  /** The name of the platform. */
  name: string;

  /** Field schema — top-level objects `credentials` and `settings` map to DB columns. */
  schema: FieldSchema[];

  /** Whether to show webhook URL for manual configuration. When true, the UI displays the webhook endpoint for the user to copy. */
  showWebhookUrl?: boolean;

  /**
   * Whether the platform supports rendering Markdown in messages.
   * When false, outbound markdown is converted to plain text before sending,
   * and the AI is instructed to avoid markdown formatting.
   * Defaults to true.
   */
  supportsMarkdown?: boolean;

  /**
   * Whether the platform supports editing sent messages.
   * When false, step progress updates are skipped and only the final reply is sent.
   * Defaults to true.
   */
  supportsMessageEdit?: boolean;
}

/** Serialized platform definition for frontend consumption (excludes runtime-only fields). */
export type SerializedPlatformDefinition = Omit<PlatformDefinition, 'clientFactory'>;
