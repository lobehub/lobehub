import type { LobeAgentConfig } from '../../agent';
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
    >
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
  profile: {
    description?: string | null;
    marketIdentifier?: string | null;
    slug?: string | null;
    tags?: string[];
  };
  routing: {
    clientId?: string | null;
    sessionId?: string | null;
    sessionGroupId?: string | null;
  };
  runtime: {
    heterogeneousType?: string | null;
    virtual?: boolean | null;
  };
}

export const AGENT_PROJECTION_FRAGMENT_NAMES =
  defineProjectionFragmentNames<AgentProjectionFragments>()([
    'access',
    'configuration',
    'identity',
    'knowledge',
    'lifecycle',
    'profile',
    'routing',
    'runtime',
  ]);
