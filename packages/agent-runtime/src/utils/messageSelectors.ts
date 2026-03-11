import type { UIChatMessage } from '@lobechat/types';

/**
 * Options for message visitor traversal
 */
export interface MessageVisitorOptions {
  /**
   * Filter by message role (e.g. 'tool', 'user', 'assistant')
   */
  role?: UIChatMessage['role'];
}

/**
 * Find the first matching result by visiting messages in reverse order (newest first).
 *
 * A generic message traversal utility following the AST visitor pattern.
 * The visitor function is called for each message that passes the filter.
 * Returns immediately when the visitor returns a non-undefined value.
 *
 * @example
 * ```typescript
 * // Extract device context from most recent tool message
 * const device = findInMessages(messages, (msg) => {
 *   const id = msg.pluginState?.metadata?.activeDeviceId;
 *   if (id) return { activeDeviceId: id };
 * }, { role: 'tool' });
 *
 * // Find latest GTD todos
 * const todos = findInMessages(messages, (msg) => {
 *   if (msg.plugin?.identifier === GTDIdentifier) return msg.pluginState?.todos;
 * }, { role: 'tool' });
 * ```
 */
export const findInMessages = <T>(
  messages: UIChatMessage[],
  visitor: (msg: UIChatMessage) => T | undefined,
  options?: MessageVisitorOptions,
): T | undefined => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (options?.role && msg.role !== options.role) continue;

    const result = visitor(msg);
    if (result !== undefined) return result;
  }

  return undefined;
};

/**
 * Collect all matching results by visiting messages in forward order.
 *
 * Unlike `findInMessages` which returns the first match, this function
 * collects all non-undefined visitor results. Useful for cumulative
 * state like activated tool IDs.
 *
 * @example
 * ```typescript
 * // Accumulate activated tool identifiers
 * const tools = collectFromMessages(messages, (msg) => {
 *   if (msg.plugin?.identifier === LobeToolIdentifier) {
 *     return msg.pluginState?.activatedTools;
 *   }
 * }, { role: 'tool' });
 * ```
 */
export const collectFromMessages = <T>(
  messages: UIChatMessage[],
  visitor: (msg: UIChatMessage) => T | undefined,
  options?: MessageVisitorOptions,
): T[] => {
  const results: T[] = [];

  for (const msg of messages) {
    if (options?.role && msg.role !== options.role) continue;

    const result = visitor(msg);
    if (result !== undefined) results.push(result);
  }

  return results;
};
