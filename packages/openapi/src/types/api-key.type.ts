import { API_KEY_FULL_ACCESS_SCOPE, API_KEY_SCOPES } from '@lobechat/const';
import { z } from 'zod';

const ApiKeyScopesSchema = z
  .array(z.enum(API_KEY_SCOPES, { error: 'Unknown API key scope' }))
  .min(1)
  .refine((scopes) => new Set(scopes).size === scopes.length, 'API key scopes must be unique')
  .transform((scopes) =>
    scopes.includes(API_KEY_FULL_ACCESS_SCOPE) ? [API_KEY_FULL_ACCESS_SCOPE] : scopes,
  );

const ExpiresAtSchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .nullable();

export const CreateApiKeyRequestSchema = z
  .object({
    expiresAt: ExpiresAtSchema.optional(),
    name: z.string().trim().min(1).max(256),
    scopes: ApiKeyScopesSchema.nullish(),
  })
  .strict();

export const UpdateApiKeyRequestSchema = z
  .object({
    enabled: z.boolean().optional(),
    expiresAt: ExpiresAtSchema.optional(),
    name: z.string().trim().min(1).max(256).optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'At least one field must be provided',
  });

export const ApiKeyIdParamSchema = z.object({ id: z.string().length(16) });

export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequestSchema>;
export type UpdateApiKeyRequest = z.infer<typeof UpdateApiKeyRequestSchema>;

export interface ApiKeyResponse {
  createdAt: Date;
  enabled: boolean | null;
  expiresAt: Date | null;
  id: string;
  lastUsedAt: Date | null;
  name: string;
  scopes: string[] | null;
  updatedAt: Date;
}

export interface CreatedApiKeyResponse extends ApiKeyResponse {
  /** Plaintext is returned only by the create operation. */
  key: string;
}
