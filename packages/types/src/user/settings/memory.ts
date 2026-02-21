export type UserMemoryEffort = 'high' | 'low' | 'medium';

export interface UserMemorySettings {
  effort?: UserMemoryEffort;
  enabled?: boolean;
}
