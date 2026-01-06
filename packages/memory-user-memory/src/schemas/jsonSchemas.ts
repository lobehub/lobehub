import { searchMemorySchema } from '@lobechat/types';
import type { PluginSchema } from '@lobehub/chat-plugin-sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { ContextMemoryItemSchema } from './context';
import { ExperienceMemoryItemSchema } from './experience';
import {
  AddIdentityActionSchema,
  RemoveIdentityActionSchema,
  UpdateIdentityActionSchema,
} from './identity';
import { PreferenceMemoryItemSchema } from './preference';

// Pre-compute JSON schemas to avoid runtime zod-to-json-schema type issues
// These are used by the builtin-tool-memory manifest

export const searchMemoryJsonSchema = zodToJsonSchema(
  searchMemorySchema,
) as unknown as PluginSchema;
export const contextMemoryJsonSchema = zodToJsonSchema(
  ContextMemoryItemSchema,
) as unknown as PluginSchema;
export const experienceMemoryJsonSchema = zodToJsonSchema(
  ExperienceMemoryItemSchema,
) as unknown as PluginSchema;
export const preferenceMemoryJsonSchema = zodToJsonSchema(
  PreferenceMemoryItemSchema,
) as unknown as PluginSchema;
export const addIdentityJsonSchema = zodToJsonSchema(
  AddIdentityActionSchema,
) as unknown as PluginSchema;
export const updateIdentityJsonSchema = zodToJsonSchema(
  UpdateIdentityActionSchema,
) as unknown as PluginSchema;
export const removeIdentityJsonSchema = zodToJsonSchema(
  RemoveIdentityActionSchema,
) as unknown as PluginSchema;
