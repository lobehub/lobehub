import type { WorkListBaseItem } from '@lobechat/types';

export type WorkCardActionsTarget = Pick<
  WorkListBaseItem,
  'id' | 'originAgentId' | 'resourceDeleted' | 'type' | 'userId'
>;

export interface WorkCardActionsProps {
  item: WorkCardActionsTarget;
}

/**
 * Business slot: extra action buttons in the title row of a Work card shown in
 * a conversation. Renders nothing by default.
 */
export default function WorkCardActions(_props: WorkCardActionsProps) {
  return null;
}
