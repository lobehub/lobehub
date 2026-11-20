import type { WorkListBaseItem } from '@lobechat/types';
import type { DropdownItem } from '@lobehub/ui';

/** The Work fields a card menu item may need to decide whether it applies. */
export type WorkCardMenuTarget = Pick<
  WorkListBaseItem,
  'id' | 'originAgentId' | 'resourceDeleted' | 'type' | 'userId'
>;

/**
 * Business slot: extra actions in the "more" menu of a Work card shown in a
 * conversation. The default adds none, and a card with no items renders no
 * menu button at all.
 */
export const useWorkCardMenuItems = (_work: WorkCardMenuTarget): DropdownItem[] | null => null;
