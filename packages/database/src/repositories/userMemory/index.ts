import type {
  UserMemoryActivityWithoutVectors,
  UserMemoryContextWithoutVectors,
  UserMemoryExperienceWithoutVectors,
  UserMemoryIdentityWithoutVectors,
  UserMemoryPreferenceWithoutVectors,
} from '@lobechat/types';

export { UserMemoryTopicRepository } from './UserMemoryTopicRepository';

export interface MemorySource {
  agentId: string | null;
  id: string;
  sessionId: string | null;
  title: string | null;
}

export interface DisplayExperienceMemory extends UserMemoryExperienceWithoutVectors {
  title: string | null;
}

export interface DisplayPreferenceMemory extends UserMemoryPreferenceWithoutVectors {
  title: string | null;
}

export type DisplayContextMemory = UserMemoryContextWithoutVectors;

export type DisplayIdentityMemory = UserMemoryIdentityWithoutVectors;

export interface DisplayActivityMemory extends UserMemoryActivityWithoutVectors {
  title: string | null;
}
