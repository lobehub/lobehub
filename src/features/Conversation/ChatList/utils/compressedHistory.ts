import type { UIChatMessage } from '@lobechat/types';

import { resolveCompressedMessageView } from '../../Messages/CompressedGroup/resolveCompressedMessageView';
import type { ChatRow } from './chatRows';

/** Older members of one compression group loaded after its node, see `loadEarlierMessages`. */
export interface CompressedHistoryPage {
  /** Loaded older members, oldest first, parsed into display nodes. */
  messages: UIChatMessage[];
  /** Members still older than `messages`, ascending. */
  omittedIds: string[];
}

const isCompressedGroup = (message: UIChatMessage) => message.role === 'compressedGroup';

/**
 * The assistant placeholder a compression captures when it runs mid-turn
 * (`content === '...'` with nothing else) is not history the reader wrote or
 * received.
 */
const isPlaceholder = (message: UIChatMessage) =>
  (message.role === 'assistant' || message.role === 'assistantGroup') &&
  message.content === '...' &&
  (!message.tools || message.tools.length === 0) &&
  (!message.children || message.children.length === 0);

const membersCache = new WeakMap<
  UIChatMessage,
  { members: UIChatMessage[]; page?: CompressedHistoryPage }
>();

/**
 * The members of a compression group that render as transcript rows: the
 * older pages loaded on scroll, then the node's own newest slice. Rows the
 * history renderer draws nothing for are dropped — notably the flat `tool`
 * rows a capped node carries only so state restores keep working, which
 * would otherwise be empty virtual-list rows.
 */
export const getCompressedHistoryMembers = (
  group: UIChatMessage,
  page?: CompressedHistoryPage,
): UIChatMessage[] => {
  // The display list keeps an unchanged group's reference across snapshots
  // (`stabilizeReferences`), so this survives every streaming tick of the
  // live turn below instead of re-filtering thousands of paged members.
  const cached = membersCache.get(group);
  if (cached && cached.page === page) return cached.members;

  const members = [...(page?.messages ?? []), ...(group.compressedMessages ?? [])].filter(
    (message) => !isPlaceholder(message) && resolveCompressedMessageView(message) !== 'none',
  );
  membersCache.set(group, { members, page });
  return members;
};

/** Ids of a group's members not loaded yet, ascending. */
export const getCompressedHistoryOmittedIds = (
  group: UIChatMessage,
  page?: CompressedHistoryPage,
): string[] => page?.omittedIds ?? group.compressedOmittedIds ?? [];

/**
 * The group whose older members load next when the reader reaches the top:
 * only when it is the oldest row on screen, i.e. everything above it lives
 * inside the group, and some members are still unloaded.
 */
export const findCompressedGroupToPage = (
  messages: UIChatMessage[],
  pages: Record<string, CompressedHistoryPage>,
): { group: UIChatMessage; untilId: string } | undefined => {
  const group = messages[0];
  if (!group || !isCompressedGroup(group)) return;

  const untilId = getCompressedHistoryOmittedIds(group, pages[group.id]).at(-1);
  return untilId ? { group, untilId } : undefined;
};

export interface CompressedRow extends ChatRow {
  /** Set on a compression member's row: the member, rendered read-only. */
  compressedMember?: UIChatMessage;
}

/**
 * Lay a compression group's original conversation out as ordinary rows right
 * above the group, so the group itself is only the divider marking where the
 * model's context was compressed and the reader scrolls straight through the
 * history. Also returns the messages with each group's members inserted
 * ahead of it: deep links resolve against that list, so a member id lands on
 * its own row instead of the group's.
 */
export const expandCompressedRows = (
  rows: ChatRow[],
  messages: UIChatMessage[],
  pages: Record<string, CompressedHistoryPage>,
): { messages: UIChatMessage[]; rows: CompressedRow[] } => {
  if (!messages.some(isCompressedGroup)) return { messages, rows };

  const membersByGroup = new Map(
    messages
      .filter(isCompressedGroup)
      .map((group) => [group.id, getCompressedHistoryMembers(group, pages[group.id])]),
  );
  const expandedRows: CompressedRow[] = [];
  for (const row of rows) {
    for (const member of membersByGroup.get(row.id) ?? []) {
      expandedRows.push({ compressedMember: member, id: member.id });
    }
    expandedRows.push(row);
  }

  const expandedMessages = messages.flatMap((message) => [
    ...(membersByGroup.get(message.id) ?? []),
    message,
  ]);

  return { messages: expandedMessages, rows: expandedRows };
};
