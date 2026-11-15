import type { MeetingActionItem, MeetingAssigneeType } from '@lobechat/types';

import type { CreateMeetingTaskItem } from '@/services/meeting';

type AssigneeRef = { id: string; type: MeetingAssigneeType } | null;

/** What the user has set for one suggested item before confirming it. */
export interface ActionItemDraft {
  assignee: AssigneeRef;
  checked: boolean;
  dueDate: string | null;
  /** The assignee the minutes suggested when this draft last synced with them. */
  suggestedAssignee: AssigneeRef;
  text: string;
}

export type DraftMap = Record<string, ActionItemDraft>;

const toRef = (item: MeetingActionItem): AssigneeRef =>
  item.assignee ? { id: item.assignee.id, type: item.assignee.type } : null;

const sameRef = (a: AssigneeRef, b: AssigneeRef) => a?.id === b?.id && a?.type === b?.type;

/**
 * Drafts for the suggested items, starting from what the minutes suggest
 * (ticked, matched assignee, extracted deadline). Drafts the user already
 * edited are kept, so a background refresh never discards their changes. When
 * the minutes' suggested assignee changes (a speaker was named), a draft whose
 * assignee the user has not overridden follows it.
 */
export const buildActionItemDrafts = (
  items: MeetingActionItem[],
  current: DraftMap = {},
): DraftMap =>
  Object.fromEntries(
    items
      .filter((item) => item.status === 'suggested')
      .map((item): [string, ActionItemDraft] => {
        const suggested = toRef(item);
        const draft = current[item.id];
        if (!draft) {
          return [
            item.id,
            {
              assignee: suggested,
              checked: true,
              dueDate: item.dueDate ?? null,
              suggestedAssignee: suggested,
              text: item.text,
            },
          ];
        }

        const untouched = sameRef(draft.assignee, draft.suggestedAssignee);
        return [
          item.id,
          {
            ...draft,
            assignee: untouched ? suggested : draft.assignee,
            suggestedAssignee: suggested,
          },
        ];
      }),
  );

/** The ticked suggestions with non-empty text, as the `createTasks` payload. */
export const selectedTaskItems = (
  suggested: MeetingActionItem[],
  drafts: DraftMap,
): CreateMeetingTaskItem[] =>
  suggested.flatMap((item) => {
    const draft = drafts[item.id];
    if (!draft?.checked || !draft.text.trim()) return [];
    return [
      { assignee: draft.assignee, dueDate: draft.dueDate, id: item.id, text: draft.text.trim() },
    ];
  });
