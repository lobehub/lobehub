import type {
  UserMemoryActivity,
  UserMemoryContext,
  UserMemoryExperience,
  UserMemoryPreference,
} from './rows';

export interface UserMemoryTimestamps {
  accessedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export enum UserMemoryContextObjectType {
  Application = 'application',
  Item = 'item',
  Knowledge = 'knowledge',
  Other = 'other',
  Person = 'person',
  Place = 'place',
}
export const CONTEXT_OBJECT_TYPES = Object.values(UserMemoryContextObjectType);

export enum UserMemoryContextSubjectType {
  Item = 'item',
  Other = 'other',
  Person = 'person',
  Pet = 'pet',
}
export const CONTEXT_SUBJECT_TYPES = Object.values(UserMemoryContextSubjectType);

export interface UserMemoryAssociatedLocation {
  address?: string | null;
  extra?: Record<string, unknown> | null;
  name?: string | null;
  tags?: string[] | null;
  type?: string | null;
}

export interface UserMemoryAssociatedObject {
  extra?: Record<string, unknown> | null;
  name?: string;
  type?: string | null;
}

export interface UserMemoryAssociatedSubject {
  extra?: Record<string, unknown> | null;
  name?: string;
  type?: string | null;
}

export type UserMemoryContextWithoutVectors = Omit<
  UserMemoryContext,
  'descriptionVector' | 'titleVector'
>;

/** The fields the list query selects; detail views use the full row. */
export type UserMemoryContextsListItem = Pick<
  UserMemoryContext,
  | 'accessedAt'
  | 'createdAt'
  | 'currentStatus'
  | 'description'
  | 'id'
  | 'metadata'
  | 'scoreImpact'
  | 'scoreUrgency'
  | 'tags'
  | 'title'
  | 'type'
  | 'updatedAt'
  | 'userId'
  | 'userMemoryIds'
>;

export type UserMemoryExperienceWithoutVectors = Omit<
  UserMemoryExperience,
  'actionVector' | 'keyLearningVector' | 'situationVector'
>;

/** The fields the list query selects; detail views use the full row. */
export type UserMemoryExperiencesListItem = Pick<
  UserMemoryExperience,
  | 'accessedAt'
  | 'action'
  | 'createdAt'
  | 'id'
  | 'keyLearning'
  | 'metadata'
  | 'scoreConfidence'
  | 'situation'
  | 'tags'
  | 'type'
  | 'updatedAt'
  | 'userId'
  | 'userMemoryId'
>;

export type UserMemoryPreferenceWithoutVectors = Omit<
  UserMemoryPreference,
  'conclusionDirectivesVector'
>;

/** The fields the list query selects; detail views use the full row. */
export type UserMemoryPreferencesListItem = Pick<
  UserMemoryPreference,
  | 'accessedAt'
  | 'conclusionDirectives'
  | 'createdAt'
  | 'id'
  | 'metadata'
  | 'scorePriority'
  | 'tags'
  | 'type'
  | 'updatedAt'
  | 'userId'
  | 'userMemoryId'
>;

export type UserMemoryActivityWithoutVectors = Omit<
  UserMemoryActivity,
  'narrativeVector' | 'feedbackVector'
>;

/** The fields the list query selects; detail views use the full row. */
export type UserMemoryActivitiesListItem = Pick<
  UserMemoryActivity,
  | 'accessedAt'
  | 'associatedLocations'
  | 'associatedObjects'
  | 'associatedSubjects'
  | 'capturedAt'
  | 'createdAt'
  | 'endsAt'
  | 'feedback'
  | 'id'
  | 'metadata'
  | 'narrative'
  | 'startsAt'
  | 'status'
  | 'tags'
  | 'timezone'
  | 'type'
  | 'updatedAt'
  | 'userId'
  | 'userMemoryId'
>;
