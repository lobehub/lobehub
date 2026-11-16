/**
 * Stream mode is the default: DingTalk recommends it and it needs no public
 * callback URL, so self-hosted deployments behind a firewall still receive
 * messages. HTTP callback mode (`webhook`) stays available for operators that
 * already configured a callback URL in the developer console.
 */
export const DEFAULT_DINGTALK_CONNECTION_MODE = 'websocket';

/**
 * Robot `msgParam` text is capped by bytes (15000, see protocol-spec §6.1),
 * and the adapter truncates at 12000 UTF-8 bytes. 4000 characters stays inside
 * that budget even when every character is a 3-byte CJK glyph.
 */
export const DINGTALK_CHAR_LIMIT = 4000;

/**
 * Client ID (formerly AppKey) and RobotCode are ASCII identifiers (`dingxxxx…`).
 * The pattern rejects pasted whitespace, quotes or a URL in the field, without
 * guessing at a prefix DingTalk might change.
 */
export const DINGTALK_IDENTIFIER_PATTERN = '^[A-Za-z0-9_-]+$';

/** Thread id prefix shared with `@lobechat/chat-adapter-dingtalk`. */
export const DINGTALK_THREAD_PREFIX = 'dingtalk';

/** Only DingTalk-issued reply webhooks are ever stored or called. */
export const DINGTALK_SESSION_WEBHOOK_HOST_PATTERN = /(^|\.)dingtalk\.com$/;
