import type {
  AddIdentityActionSchema,
  ContextMemoryItemSchema,
  ExperienceMemoryItemSchema,
  PreferenceMemoryItemSchema,
  RemoveIdentityActionSchema,
  UpdateIdentityActionSchema,
} from '@lobechat/memory-user-memory/schemas';
import type {  SearchMemoryResult } from '@lobechat/types';
import type { z } from 'zod';

export const MemoryApiName = {
  addContextMemory: 'addContextMemory',
  addExperienceMemory: 'addExperienceMemory',
  addIdentityMemory: 'addIdentityMemory',
  addPreferenceMemory: 'addPreferenceMemory',
  removeIdentityMemory: 'removeIdentityMemory',
  searchUserMemory: 'searchUserMemory',
  updateIdentityMemory: 'updateIdentityMemory',
} as const;

export type MemoryApiNameType = (typeof MemoryApiName)[keyof typeof MemoryApiName];

/** @deprecated Use MemoryApiName instead */
export const UserMemoryApiName = MemoryApiName;

// ==================== Inspector Types ====================

// Search

// SearchUserMemoryState is the same as SearchMemoryResult (executor returns result directly as state)
export type SearchUserMemoryState = SearchMemoryResult;

// Add Context
export type AddContextMemoryParams = z.infer<typeof ContextMemoryItemSchema>;
export interface AddContextMemoryState {
  contextId?: string;
  memoryId?: string;
}

// Add Experience
export type AddExperienceMemoryParams = z.infer<typeof ExperienceMemoryItemSchema>;
export interface AddExperienceMemoryState {
  experienceId?: string;
  memoryId?: string;
}

// Add Identity
export type AddIdentityMemoryParams = z.infer<typeof AddIdentityActionSchema>;
export interface AddIdentityMemoryState {
  identityId?: string;
  memoryId?: string;
}

// Add Preference
export type AddPreferenceMemoryParams = z.infer<typeof PreferenceMemoryItemSchema>;
export interface AddPreferenceMemoryState {
  memoryId?: string;
  preferenceId?: string;
}

// Update Identity
export type UpdateIdentityMemoryParams = z.infer<typeof UpdateIdentityActionSchema>;
export interface UpdateIdentityMemoryState {
  identityId?: string;
}

// Remove Identity
export type RemoveIdentityMemoryParams = z.infer<typeof RemoveIdentityActionSchema>;
export interface RemoveIdentityMemoryState {
  identityId?: string;
  reason?: string;
}

export {type SearchMemoryParams, type SearchMemoryResult} from '@lobechat/types';