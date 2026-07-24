export const PLUGIN_SCHEMA_SEPARATOR = '____';
export const PLUGIN_SCHEMA_API_MD5_PREFIX = 'MD5HASH_';

/**
 * Canonical parse for a raw `TOOL_NAME_MAX_LENGTH` value — the length at which a
 * function-call tool name is compressed into an opaque `MD5HASH_…` name, `0`
 * turning that compression off.
 *
 * Returns `undefined` for unset / unparseable / negative input, meaning "not
 * configured": callers fall back to the default rather than failing, because a
 * typo in this var must never take a deployment down.
 *
 * Lives here, in a leaf module, because the var is read from two sides:
 * `ToolNameResolver` reads `process.env` directly on the server, while the app
 * ships the value to the browser with the global server config (the
 * client-driven chat path generates tool names where `process.env` isn't
 * visible). Parsing it with two different rule sets would let one env value mean
 * two different things, and the same tool could get different names on each side.
 */
export const parseToolNameMaxLength = (raw: string | undefined): number | undefined => {
  if (raw === undefined || raw === '') return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

export const ARTIFACT_TAG = 'lobeArtifact';
export const ARTIFACT_THINKING_TAG = 'lobeThinking';
export const MENTION_TAG = 'mention';
export const THINKING_TAG = 'think';
export const LOCAL_FILE_TAG = 'localFile';
export const SKILL_TAG = 'skill';
export const TASK_TAG = 'task';
export const TOOL_TAG = 'tool';
export const USER_FEEDBACK_TAG = 'user_feedback';
// https://regex101.com/r/TwzTkf/2
export const ARTIFACT_TAG_REGEX = /<lobeArtifact\b[^>]*>(?<content>[\S\s]*?)(?:<\/lobeArtifact>|$)/;

// https://regex101.com/r/r9gqGg/1
export const ARTIFACT_TAG_CLOSED_REGEX = /<lobeArtifact\b[^>]*>([\S\s]*?)<\/lobeArtifact>/;

// https://regex101.com/r/AvPA2g/1
export const ARTIFACT_THINKING_TAG_REGEX = /<lobeThinking\b[^>]*>([\S\s]*?)(?:<\/lobeThinking>|$)/;

export const THINKING_TAG_REGEX = /<think\b[^>]*>([\S\s]*?)(?:<\/think>|$)/;

export const MENTION_TAG_REGEX = /<mention\b[^>]*>([\S\s]*?)(?:<\/mention>|$)/;

export const AGENTS_TAG = 'lobeAgents';
export const AGENTS_TAG_REGEX = /<lobeAgents\b[^>]*(?:\/>|>([\S\s]*?)(?:<\/lobeAgents>|$))/;
