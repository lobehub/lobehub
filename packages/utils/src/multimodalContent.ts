import type { MessageContentPart } from '@lobechat/types';

/**
 * Serialize message content parts to JSON string for storage
 */
export function serializePartsForStorage(parts: MessageContentPart[]): string {
  return JSON.stringify(parts);
}

/**
 * Deserialize content string to message content parts
 * Returns null if content is not valid JSON array of parts
 */
export function deserializeParts(content: string): MessageContentPart[] | null {
  try {
    const parsed = JSON.parse(content);
    // Validate it's an array with valid part structure
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every(
        (part) =>
          part !== null &&
          typeof part === 'object' &&
          !Array.isArray(part) &&
          typeof part.type === 'string' &&
          part.type.length > 0,
      )
    ) {
      return parsed as MessageContentPart[];
    }
  } catch {
    // Not JSON, treat as plain text
  }
  return null;
}
