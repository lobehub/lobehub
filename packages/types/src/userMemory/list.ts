import type { UserMemoryListItem, UserMemoryWithoutVectors } from './base';
import type { UserMemoryIdentitiesListItem, UserMemoryIdentityWithoutVectors } from './identity';
import type {
  UserMemoryActivitiesListItem,
  UserMemoryActivityWithoutVectors,
  UserMemoryContextsListItem,
  UserMemoryContextWithoutVectors,
  UserMemoryExperiencesListItem,
  UserMemoryExperienceWithoutVectors,
  UserMemoryPreferencesListItem,
  UserMemoryPreferenceWithoutVectors,
} from './layers';
import type { LayersEnum } from './shared';

export interface TopicSource {
  agentId: string | null;
  id: string;
  sessionId: string | null;
  title: string | null;
}

// TODO: Extend to other source types later, e.g. Notion, Obsidian, YuQue
export type MemorySource = TopicSource;

export enum MemorySourceType {
  BenchmarkLocomo = 'benchmark_locomo',
  ChatTopic = 'chat_topic',
}

export interface ContextMemorySimple {
  context: UserMemoryContextsListItem;
  layer: LayersEnum.Context;
  memory: UserMemoryListItem;
}

export interface ContextMemoryDetail {
  context: UserMemoryContextWithoutVectors;
  layer: LayersEnum.Context;
  memory: UserMemoryWithoutVectors;
  source?: MemorySource;
  sourceType?: MemorySourceType;
}

export interface ExperienceMemorySimple {
  experience: UserMemoryExperiencesListItem;
  layer: LayersEnum.Experience;
  memory: UserMemoryListItem;
}

export interface ExperienceMemoryDetail {
  experience: UserMemoryExperienceWithoutVectors;
  layer: LayersEnum.Experience;
  memory: UserMemoryWithoutVectors;
  source?: MemorySource;
  sourceType?: MemorySourceType;
}

export interface PreferenceMemorySimple {
  layer: LayersEnum.Preference;
  memory: UserMemoryListItem;
  preference: UserMemoryPreferencesListItem;
}

export interface PreferenceMemoryDetail {
  layer: LayersEnum.Preference;
  memory: UserMemoryWithoutVectors;
  preference: UserMemoryPreferenceWithoutVectors;
  source?: MemorySource;
  sourceType?: MemorySourceType;
}

export interface IdentityMemorySimple {
  identity: UserMemoryIdentitiesListItem;
  layer: LayersEnum.Identity;
  memory: UserMemoryListItem;
}

export interface IdentityMemoryDetail {
  identity: UserMemoryIdentityWithoutVectors;
  layer: LayersEnum.Identity;
  memory: UserMemoryWithoutVectors;
  source?: MemorySource;
  sourceType?: MemorySourceType;
}

export interface ActivityMemorySimple {
  activity: UserMemoryActivitiesListItem;
  layer: LayersEnum.Activity;
  memory: UserMemoryListItem;
}

export interface ActivityMemoryDetail {
  activity: UserMemoryActivityWithoutVectors;
  layer: LayersEnum.Activity;
  memory: UserMemoryWithoutVectors;
  source?: MemorySource;
  sourceType?: MemorySourceType;
}

export type UserMemoryItemSimple =
  | ContextMemorySimple
  | ExperienceMemorySimple
  | IdentityMemorySimple
  | PreferenceMemorySimple
  | ActivityMemorySimple;

export type UserMemoryDetail =
  | ContextMemoryDetail
  | ExperienceMemoryDetail
  | IdentityMemoryDetail
  | PreferenceMemoryDetail
  | ActivityMemoryDetail;
