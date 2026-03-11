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

export interface UserMemoryContext extends UserMemoryTimestamps {
  associatedObjects:
    | {
        extra?: Record<string, unknown> | null;
        name?: string;
        type?: UserMemoryContextObjectType;
      }[]
    | null;
  associatedSubjects:
    | {
        extra?: Record<string, unknown> | null;
        name?: string;
        type?: UserMemoryContextSubjectType;
      }[]
    | null;
  currentStatus: string | null;
  description: string | null;
  descriptionVector: number[] | null;
  id: string;
  metadata: Record<string, unknown> | null;
  scoreImpact: number | null;
  scoreUrgency: number | null;
  tags: string[] | null;
  title: string | null;
  titleVector: number[] | null;
  type: string | null;
  userId: string | null;
  userMemoryIds: string[] | null;
}

export type UserMemoryContextWithoutVectors = Omit<
  UserMemoryContext,
  'descriptionVector' | 'titleVector'
>;

export type UserMemoryContextsListItem = Omit<
  UserMemoryContextWithoutVectors,
  'associatedObjects' | 'associatedSubjects'
>;

export interface UserMemoryExperience extends UserMemoryTimestamps {
  action: string | null;
  actionVector: number[] | null;
  id: string;
  keyLearning: string | null;
  keyLearningVector: number[] | null;
  metadata: Record<string, unknown> | null;
  possibleOutcome: string | null;
  reasoning: string | null;
  scoreConfidence: number | null;
  situation: string | null;
  situationVector: number[] | null;
  tags: string[] | null;
  type: string | null;
  userId: string | null;
  userMemoryId: string | null;
}

export type UserMemoryExperienceWithoutVectors = Omit<
  UserMemoryExperience,
  'actionVector' | 'keyLearningVector' | 'situationVector'
>;

export type UserMemoryExperiencesListItem = Omit<
  UserMemoryExperienceWithoutVectors,
  'possibleOutcome' | 'reasoning'
>;

export interface UserMemoryPreference extends UserMemoryTimestamps {
  conclusionDirectives: string | null;
  conclusionDirectivesVector: number[] | null;
  id: string;
  metadata: Record<string, unknown> | null;
  scorePriority: number | null;
  suggestions: string | null;
  tags: string[] | null;
  type: string | null;
  userId: string | null;
  userMemoryId: string | null;
}

export type UserMemoryPreferenceWithoutVectors = Omit<
  UserMemoryPreference,
  'conclusionDirectivesVector'
>;

export type UserMemoryPreferencesListItem = Omit<UserMemoryPreferenceWithoutVectors, 'suggestions'>;

export interface UserMemoryActivity extends UserMemoryTimestamps {
  associatedLocations: UserMemoryAssociatedLocation[] | null;
  associatedObjects: UserMemoryAssociatedObject[] | null;
  associatedSubjects: UserMemoryAssociatedSubject[] | null;
  endsAt: Date | null;
  feedback: string | null;
  feedbackVector: number[] | null;
  id: string;
  metadata: Record<string, unknown> | null;
  narrative: string | null;
  narrativeVector: number[] | null;
  notes: string | null;
  startsAt: Date | null;
  status: string | null;
  tags: string[] | null;
  timezone: string | null;
  type: string | null;
  userId: string | null;
  userMemoryId: string | null;
}

export type UserMemoryActivityWithoutVectors = Omit<
  UserMemoryActivity,
  'narrativeVector' | 'feedbackVector'
>;

export type UserMemoryActivitiesListItem = Omit<
  UserMemoryActivityWithoutVectors,
  'feedback' | 'narrative' | 'notes'
>;
