/**
 * Hard cap for `message_plugins.identifier` / `api_name`. Hallucinated tool
 * calls have stuffed multi-KB payloads (artifact XML, shell commands) into
 * these columns; once the columns are btree-indexed, any value past the index
 * tuple size limit makes the whole row insert fail, so every write path must
 * clamp before hitting the database.
 */
export const MAX_TOOL_IDENTIFIER_LENGTH = 255;

export const clampToolIdentifier = <T extends string | null | undefined>(value: T): T =>
  value && value.length > MAX_TOOL_IDENTIFIER_LENGTH
    ? (value.slice(0, MAX_TOOL_IDENTIFIER_LENGTH) as T)
    : value;
