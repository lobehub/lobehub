import { z } from 'zod';

import type { UserMemoryIdentity } from './rows';
import type { BaseListItem, BaseListParams, BaseListResult } from './shared';

export type IdentityType = 'personal' | 'professional' | 'demographic';

/**
 * Identity query types for list display
 * These are flat structures optimized for frontend rendering
 */

export type IdentityListSort = 'capturedAt' | 'type';

export interface IdentityListParams extends BaseListParams {
  relationships?: string[];
  sort?: IdentityListSort;
}

/**
 * Flat structure for identity list items
 * Contains fields needed for card display
 */
export interface IdentityListItem extends BaseListItem {
  description: string | null;
  episodicDate: Date | null;
  relationship: string | null;
  role: string | null;
}

export type IdentityListResult = BaseListResult<IdentityListItem>;

export type UserMemoryIdentityWithoutVectors = Omit<UserMemoryIdentity, 'descriptionVector'>;

/** The fields the list query selects; detail views use the full row. */
export type UserMemoryIdentitiesListItem = Pick<
  UserMemoryIdentity,
  | 'accessedAt'
  | 'capturedAt'
  | 'createdAt'
  | 'description'
  | 'episodicDate'
  | 'id'
  | 'metadata'
  | 'relationship'
  | 'role'
  | 'tags'
  | 'type'
  | 'updatedAt'
  | 'userId'
  | 'userMemoryId'
>;

export interface NewUserMemoryIdentity {
  description?: string;
  episodicDate?: string;
  extractedLabels?: string[];
  labels?: Record<string, any>;
  relationship?: string;
  role?: string;
  type?: IdentityType;
  userMemoryId?: string;
}

export interface UpdateUserMemoryIdentity {
  description?: string;
  episodicDate?: string;
  extractedLabels?: string[];
  labels?: Record<string, any>;
  relationship?: string;
  role?: string;
  type?: IdentityType;
}

export const IdentityTypeSchema = z.enum(['personal', 'professional', 'demographic']);

export const CreateUserMemoryIdentitySchema = z.object({
  description: z.string().optional(),
  episodicDate: z.string().optional(),
  extractedLabels: z.array(z.string()).optional(),
  labels: z.record(z.string(), z.any()).optional(),
  relationship: z.string().optional(),
  role: z.string().optional(),
  type: IdentityTypeSchema.optional(),
  userMemoryId: z.string().optional(),
});

export const UpdateUserMemoryIdentitySchema = z.object({
  description: z.string().optional(),
  episodicDate: z.string().optional(),
  extractedLabels: z.array(z.string()).optional(),
  labels: z.record(z.string(), z.any()).optional(),
  relationship: z.string().optional(),
  role: z.string().optional(),
  type: IdentityTypeSchema.optional(),
});
