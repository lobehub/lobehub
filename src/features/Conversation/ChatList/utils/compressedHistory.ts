import type { UIChatMessage } from '@lobechat/types';

import { resolveCompressedMessageView } from '../../Messages/CompressedGroup/resolveCompressedMessageView';
import type { ChatRow } from './chatRows';

/** Older members of one compression group loaded after its node, see `loadEarlierMessages`. */
export interface CompressedHistoryPage {
  /** Loaded older members, oldest first, parsed into display nodes. */
  messages: UIChatMessage[];
  /** Newest member still older than `messages`, the next page's `untilId`; absent at the group start. */
  nextUntilId?: string;
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

/** The newest of a group's members not loaded yet, or `undefined` once all are. */
export const getCompressedHistoryNextUntilId = (
  group: UIChatMessage,
  page?: CompressedHistoryPage,
): string | undefined => (page ? page.nextUntilId : group.compressedOmittedIds?.at(-1));

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

  const untilId = getCompressedHistoryNextUntilId(group, pages[group.id]);
  return untilId ? { group, untilId } : undefined;
};

export interface CompressedRow extends ChatRow {
  /**
   * Set on the row marking a later group's unloaded members, between the
   * group above and this group's loaded ones: the id of the group to page.
   */
  compressedGap?: string;
  /** Set on a compression member's row: the member, rendered read-only. */
  compressedMember?: UIChatMessage;
}

/** Row id of a group's unloaded-members gap, see `CompressedRow.compressedGap`. */
export const compressedGapRowId = (groupId: string) => `${groupId}:earlier`;

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
  /**
   * Whether unloaded members can be paged in. Share views cannot (the member
   * page is owner-only), so they get no gap row that would load nothing.
   */
  { pageable = true }: { pageable?: boolean } = {},
): { messages: UIChatMessage[]; rows: CompressedRow[] } => {
  if (!messages.some(isCompressedGroup)) return { messages, rows };

  const membersByGroup = new Map(
    messages
      .filter(isCompressedGroup)
      .map((group) => [group.id, getCompressedHistoryMembers(group, pages[group.id])]),
  );
  // Only the oldest row pages on reaching the top (`findCompressedGroupToPage`);
  // any later capped group has its gap in the middle of the transcript.
  const firstId = messages[0]?.id;
  const groupById = new Map(messages.filter(isCompressedGroup).map((group) => [group.id, group]));
  const expandedRows: CompressedRow[] = [];
  for (const row of rows) {
    const group = groupById.get(row.id);
    if (
      pageable &&
      group &&
      group.id !== firstId &&
      getCompressedHistoryNextUntilId(group, pages[group.id])
    )
      expandedRows.push({ compressedGap: group.id, id: compressedGapRowId(group.id) });
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
