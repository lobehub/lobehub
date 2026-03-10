import type {
  UserMemoryActivitiesWithoutVectors,
  UserMemoryContextsWithoutVectors,
  UserMemoryExperiencesWithoutVectors,
  UserMemoryIdentitiesWithoutVectors,
  UserMemoryPreferencesWithoutVectors,
} from '../../schemas';

export { UserMemoryTopicRepository } from './UserMemoryTopicRepository';

export interface MemorySource {
  agentId: string | null;
  id: string;
  sessionId: string | null;
  title: string | null;
}

export interface DisplayExperienceMemory extends UserMemoryExperiencesWithoutVectors {
  title: string | null;
}

export interface DisplayPreferenceMemory extends UserMemoryPreferencesWithoutVectors {
  title: string | null;
}

export type DisplayContextMemory = UserMemoryContextsWithoutVectors;

export type DisplayIdentityMemory = UserMemoryIdentitiesWithoutVectors;

export interface DisplayActivityMemory extends UserMemoryActivitiesWithoutVectors {
  title: string | null;
}
