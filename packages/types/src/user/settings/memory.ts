export type UserMemoryEffort = 'high' | 'low' | 'medium';

export type UserMemoryPreferredLanguage = 'auto' | string;

export interface UserMemorySettings {
  effort?: UserMemoryEffort;
  enabled?: boolean;
  preferredLanguage?: UserMemoryPreferredLanguage;
}
