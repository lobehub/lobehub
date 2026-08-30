import type { AgentItem, LobeAgentConfig } from '../../agent';
import { defineProjectionFragmentNames } from '../runtime';
import type { ProjectionAvatar, ProjectionVisibility } from './shared';

export interface AgentProjectionFragments {
  access: {
    userId?: string | null;
    visibility?: ProjectionVisibility;
    workspaceId?: string | null;
  };
  configuration: Partial<
    Pick<
      LobeAgentConfig,
      | 'agencyConfig'
      | 'chatConfig'
      | 'editorData'
      | 'fewShots'
      | 'model'
      | 'openingMessage'
      | 'openingQuestions'
      | 'params'
      | 'plugins'
      | 'provider'
      | 'systemRole'
      | 'tts'
    > &
      Pick<AgentItem, 'clientId' | 'sessionGroupId'>
  >;
  identity: {
    avatar?: ProjectionAvatar;
    backgroundColor?: string | null;
    name?: string | null;
    title?: string | null;
  };
  knowledge: Pick<LobeAgentConfig, 'files' | 'knowledgeBases'>;
  lifecycle: {
    createdAt?: Date | number | string;
    updatedAt?: Date | number | string;
  };
  metadata: Pick<AgentItem, 'marketIdentifier' | 'tags' | 'virtual'>;
  profile: {
    description?: string | null;
    slug?: string | null;
  };
  routing: {
    sessionId?: string | null;
  };
  runtime: {
    heterogeneousType?: string | null;
  };
}

export const AGENT_PROJECTION_FRAGMENT_NAMES =
  defineProjectionFragmentNames<AgentProjectionFragments>()([
    'access',
    'configuration',
    'identity',
    'knowledge',
    'lifecycle',
    'metadata',
    'profile',
    'routing',
    'runtime',
  ]);
