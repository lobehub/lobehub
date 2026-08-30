import type { AgentGroupDetail, ChatGroupItem } from '../../agentGroup';
import type { ProjectionRef } from '../base';
import { defineProjectionFragmentNames } from '../runtime';
import type { ProjectionAvatar, ProjectionVisibility } from './shared';

export interface ChatGroupProjectionFragments {
  access: {
    userId?: string | null;
    visibility?: ProjectionVisibility;
    workspaceId?: string | null;
  };
  configuration: Partial<
    Pick<
      ChatGroupItem,
      'clientId' | 'config' | 'content' | 'editorData' | 'groupId' | 'marketIdentifier' | 'pinned'
    >
  >;
  identity: {
    avatar?: ProjectionAvatar;
    backgroundColor?: string | null;
    description?: string | null;
    title: string | null;
  };
  lifecycle: {
    accessedAt?: Date | number | string;
    createdAt?: Date | number | string;
    updatedAt?: Date | number | string;
  };
  membership: {
    agents: Array<ProjectionRef<'agent'> & { isSupervisor: boolean }>;
    supervisorAgentId?: AgentGroupDetail['supervisorAgentId'];
  };
  sidebar: {
    groupAvatar?: string | null;
  };
}

export const CHAT_GROUP_PROJECTION_FRAGMENT_NAMES =
  defineProjectionFragmentNames<ChatGroupProjectionFragments>()([
    'access',
    'configuration',
    'identity',
    'lifecycle',
    'membership',
    'sidebar',
  ]);
