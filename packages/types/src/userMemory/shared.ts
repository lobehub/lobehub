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
  OnHold = 'on_hold',
  Ongoing = 'ongoing',
  Planned = 'planned',
}
export const CONTEXT_STATUS = Object.values(ContextStatusEnum);
