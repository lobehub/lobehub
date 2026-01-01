import { z } from 'zod';

export type IdentityType = 'personal' | 'professional' | 'demographic';

export interface UserMemoryIdentity {
  accessedAt: Date;
  createdAt: Date;
  description?: string | null;
  descriptionVector?: number[] | null;
  episodicDate?: Date | null;
  id: string;
  metadata?: Record<string, unknown> | null;
  relationship?: string | null;
  role?: string | null;
  tags?: string[] | null;
  type?: string | null;
  updatedAt: Date;
  userId?: string | null;
  userMemoryId?: string | null;
}

export type UserMemoryIdentityWithoutVectors = Omit<UserMemoryIdentity, 'descriptionVector'>;

export type UserMemoryIdentitiesListItem = UserMemoryIdentityWithoutVectors;

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
  labels: z.record(z.any()).optional(),
  relationship: z.string().optional(),
  role: z.string().optional(),
  type: IdentityTypeSchema.optional(),
  userMemoryId: z.string().optional(),
});

export const UpdateUserMemoryIdentitySchema = z.object({
  description: z.string().optional(),
  episodicDate: z.string().optional(),
  extractedLabels: z.array(z.string()).optional(),
  labels: z.record(z.any()).optional(),
  relationship: z.string().optional(),
  role: z.string().optional(),
  type: IdentityTypeSchema.optional(),
});
