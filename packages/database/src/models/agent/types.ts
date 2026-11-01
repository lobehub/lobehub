import type { DeviceBoundAgentItem, LobeAgentAgencyConfig } from '@lobechat/types';

/** One chat group an agent belongs to, as surfaced by the transfer guards. */
/**
 * A row of {@link AgentModel.queryBoundToDevice}: display fields plus the
 * stored routing config and ownership needed to resolve the caller's
 * effective target.
 */
export interface DeviceBindingCandidate extends DeviceBoundAgentItem {
  agencyConfig: LobeAgentAgencyConfig | null;
  userId: string;
  workspaceId: string | null;
}

export interface AgentGroupMembershipRef {
  agentId: string;
  /** `null` when the group is not visible to the caller (see the read below). */
  groupAvatar: string | null;
  groupBackgroundColor: string | null;
  /**
   * `null` when the group is not visible to the caller. The id is identity
   * too: the membership still counts toward the guard, but a private group's
   * identifier is no more the caller's to read than its name.
   */
  groupId: string | null;
  /** `null` when the group is not visible to the caller (see the read below). */
  groupTitle: string | null;
  /**
   * Whether the caller may see this group at all. Carried explicitly because a
   * `null` title is otherwise ambiguous — a group can simply be untitled — and
   * telling someone a group of theirs is "one you cannot see" is worse than
   * saying nothing.
   */
  groupVisible: boolean;
}

export interface AgentTransferOptions {
  rejectForeignTopicCommentAuthors?: boolean;
}
