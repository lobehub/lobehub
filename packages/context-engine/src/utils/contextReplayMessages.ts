import type { ContextReplaySnapshot, UIChatMessage } from '@lobechat/types';

const childKeys = ['children', 'pinnedMessages', 'messages', 'tools', 'result'];

const visit = (
  value: unknown,
  transform: (node: Record<string, unknown>) => Record<string, unknown>,
): unknown => {
  if (Array.isArray(value)) return value.map((item) => visit(item, transform));
  if (!value || typeof value !== 'object') return value;
  const node = transform(value as Record<string, unknown>);
  return Object.fromEntries(
    Object.entries(node).map(([key, child]) => [
      key,
      childKeys.includes(key) ? visit(child, transform) : child,
    ]),
  );
};

export const contextReplayMessageIds = (messages: UIChatMessage[]): string[] => {
  const ids = new Set<string>();
  visit(messages, (node) => {
    if (typeof node.id === 'string' && typeof node.role === 'string') ids.add(node.id);
    return node;
  });
  return [...ids];
};

/** Only snapshots from the private store are trusted, never message DTO metadata. */
export const withContextReplays = (
  messages: UIChatMessage[],
  snapshots: Record<string, ContextReplaySnapshot>,
): UIChatMessage[] =>
  visit(messages, (node) => {
    if (typeof node.id !== 'string' || typeof node.role !== 'string') return node;
    const { contextReplay: _untrusted, ...metadata } = (node.metadata ?? {}) as Record<
      string,
      unknown
    >;
    return {
      ...node,
      metadata: { ...metadata, ...(snapshots[node.id] && { contextReplay: snapshots[node.id] }) },
    };
  }) as UIChatMessage[];
