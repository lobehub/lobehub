export enum RelationshipEnum {
  Aunt = 'aunt',
  Brother = 'brother',
  Classmate = 'classmate',
  Colleague = 'colleague',
  Couple = 'couple',
  Coworker = 'coworker',
  Daughter = 'daughter',
  Father = 'father',
  Friend = 'friend',
  Granddaughter = 'granddaughter',
  Grandfather = 'grandfather',
  Grandmother = 'grandmother',
  Grandson = 'grandson',
  Husband = 'husband',
  Manager = 'manager',
  Mentee = 'mentee',
  Mentor = 'mentor',
  Mother = 'mother',
  Nephew = 'nephew',
  Niece = 'niece',
  Other = 'other',
  Partner = 'partner',
  Self = 'self',
  Sibling = 'sibling',
  Sister = 'sister',
  Son = 'son',
  Spouse = 'spouse',
  Teammate = 'teammate',
  Uncle = 'uncle',
  Wife = 'wife',
}
export const RELATIONSHIPS = Object.values(RelationshipEnum);

export enum MergeStrategyEnum {
  Merge = 'merge',
  Replace = 'replace',
}
export const MERGE_STRATEGIES = Object.values(MergeStrategyEnum);

export enum IdentityTypeEnum {
  Demographic = 'demographic',
  Personal = 'personal',
  Professional = 'professional',
}
export const IDENTITY_TYPES = Object.values(IdentityTypeEnum);

export enum LayersEnum {
  Activity = 'activity',
  Context = 'context',
  Experience = 'experience',
  Identity = 'identity',
  Preference = 'preference',
}
export const MEMORY_LAYERS = Object.values(LayersEnum);

export enum TypesEnum {
  Activity = 'activity',
  Context = 'context',
  Event = 'event',
  Fact = 'fact',
  Location = 'location',
  Other = 'other',
  People = 'people',
  Preference = 'preference',
  Technology = 'technology',
  Topic = 'topic',
}
export const MEMORY_TYPES = Object.values(TypesEnum);

export enum ContextStatusEnum {
  Aborted = 'aborted',
  Cancelled = 'cancelled',
  Completed = 'completed',
  Ongoing = 'ongoing',
  OnHold = 'on_hold',
  Planned = 'planned',
}
export const CONTEXT_STATUS = Object.values(ContextStatusEnum);

/**
 * Shared types for memory list queries
 */
export interface BaseListParams {
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  q?: string;
  tags?: string[];
  types?: string[];
}

export interface BaseListResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface BaseListItem {
  capturedAt: Date;
  createdAt: Date;
  id: string;
  tags: string[] | null;
  title: string | null;
  type: string | null;
  updatedAt: Date;
}

export enum ActivityTypeEnum {
  Appointment = 'appointment',
  Call = 'call',
  Celebration = 'celebration',
  Class = 'class',
  Conference = 'conference',
  Errand = 'errand',
  Event = 'event',
  Exercise = 'exercise',
  Meal = 'meal',
  Meeting = 'meeting',
  Other = 'other',
  ProjectSession = 'project-session',
  Social = 'social',
  Task = 'task',
  Trip = 'trip',
  Workshop = 'workshop',
}

export const ACTIVITY_TYPES = Object.values(ActivityTypeEnum);
