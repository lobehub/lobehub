import type {
  ActivityMemoryItemSchema,
  AddIdentityActionSchema,
  ContextMemoryItemSchema,
  ExperienceMemoryItemSchema,
  PreferenceMemoryItemSchema,
  RemoveIdentityActionSchema,
  UpdateIdentityActionSchema,
} from '@lobechat/memory-user-memory/schemas';
import { formatMemorySearchResults } from '@lobechat/prompts';
import type {
  AddActivityMemoryResult,
  AddContextMemoryResult,
  AddExperienceMemoryResult,
  AddIdentityMemoryResult,
  AddPreferenceMemoryResult,
  BuiltinServerRuntimeOutput,
  RemoveIdentityMemoryResult,
  SearchMemoryParams,
  SearchMemoryResult,
  UpdateIdentityMemoryResult,
} from '@lobechat/types';
import type { z } from 'zod';

export interface MemoryRuntimeService {
  addActivityMemory: (
    params: z.infer<typeof ActivityMemoryItemSchema>,
  ) => Promise<AddActivityMemoryResult>;
  addContextMemory: (
    params: z.infer<typeof ContextMemoryItemSchema>,
  ) => Promise<AddContextMemoryResult>;
  addExperienceMemory: (
    params: z.infer<typeof ExperienceMemoryItemSchema>,
  ) => Promise<AddExperienceMemoryResult>;
  addIdentityMemory: (
    params: z.infer<typeof AddIdentityActionSchema>,
  ) => Promise<AddIdentityMemoryResult>;
  addPreferenceMemory: (
    params: z.infer<typeof PreferenceMemoryItemSchema>,
  ) => Promise<AddPreferenceMemoryResult>;
  removeIdentityMemory: (
    params: z.infer<typeof RemoveIdentityActionSchema>,
  ) => Promise<RemoveIdentityMemoryResult>;
  searchMemory: (params: SearchMemoryParams) => Promise<SearchMemoryResult>;
  updateIdentityMemory: (
    params: z.infer<typeof UpdateIdentityActionSchema>,
  ) => Promise<UpdateIdentityMemoryResult>;
}

export type MemoryToolPermission = 'read-only' | 'read-write';

export interface MemoryExecutionRuntimeOptions {
  service: MemoryRuntimeService;
  toolPermission?: MemoryToolPermission;
}

const READ_ONLY_RESULT: BuiltinServerRuntimeOutput = {
  content: 'Memory tool is in read-only mode for this chat',
  success: false,
};

export class MemoryExecutionRuntime {
  private service: MemoryRuntimeService;
  private toolPermission: MemoryToolPermission;

  constructor(options: MemoryExecutionRuntimeOptions) {
    this.service = options.service;
    this.toolPermission = options.toolPermission ?? 'read-write';
  }

  private get isReadOnly() {
    return this.toolPermission === 'read-only';
  }

  async searchUserMemory(params: SearchMemoryParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.searchMemory(params);

      return {
        content: formatMemorySearchResults({ query: params.query, results: result }),
        state: result,
        success: true,
      };
    } catch (e) {
      return {
        content: `searchUserMemory with error detail: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async addContextMemory(
    params: z.infer<typeof ContextMemoryItemSchema>,
  ): Promise<BuiltinServerRuntimeOutput> {
    if (this.isReadOnly) return READ_ONLY_RESULT;
    try {
      const result = await this.service.addContextMemory(params);

      if (!result.success) {
        return { content: result.message, success: false };
      }

      return {
        content: `Context memory "${params.title}" saved with memoryId: "${result.memoryId}" and contextId: "${result.contextId}"`,
        state: { contextId: result.contextId, memoryId: result.memoryId },
        success: true,
      };
    } catch (e) {
      return {
        content: `addContextMemory with error detail: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async addActivityMemory(
    params: z.infer<typeof ActivityMemoryItemSchema>,
  ): Promise<BuiltinServerRuntimeOutput> {
    if (this.isReadOnly) return READ_ONLY_RESULT;
    try {
      const result = await this.service.addActivityMemory(params);

      if (!result.success) {
        return { content: result.message, success: false };
      }

      return {
        content: `Activity memory "${params.title}" saved with memoryId: "${result.memoryId}" and activityId: "${result.activityId}"`,
        state: { activityId: result.activityId, memoryId: result.memoryId },
        success: true,
      };
    } catch (e) {
      return {
        content: `addActivityMemory with error detail: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async addExperienceMemory(
    params: z.infer<typeof ExperienceMemoryItemSchema>,
  ): Promise<BuiltinServerRuntimeOutput> {
    if (this.isReadOnly) return READ_ONLY_RESULT;
    try {
      const result = await this.service.addExperienceMemory(params);

      if (!result.success) {
        return { content: result.message, success: false };
      }

      return {
        content: `Experience memory "${params.title}" saved with memoryId: "${result.memoryId}" and experienceId: "${result.experienceId}"`,
        state: { experienceId: result.experienceId, memoryId: result.memoryId },
        success: true,
      };
    } catch (e) {
      return {
        content: `addExperienceMemory with error detail: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async addIdentityMemory(
    params: z.infer<typeof AddIdentityActionSchema>,
  ): Promise<BuiltinServerRuntimeOutput> {
    if (this.isReadOnly) return READ_ONLY_RESULT;
    try {
      const result = await this.service.addIdentityMemory(params);

      if (!result.success) {
        return { content: result.message, success: false };
      }

      return {
        content: `Identity memory "${params.title}" saved with memoryId: "${result.memoryId}" and identityId: "${result.identityId}"`,
        state: { identityId: result.identityId, memoryId: result.memoryId },
        success: true,
      };
    } catch (e) {
      return {
        content: `addIdentityMemory with error detail: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async addPreferenceMemory(
    params: z.infer<typeof PreferenceMemoryItemSchema>,
  ): Promise<BuiltinServerRuntimeOutput> {
    if (this.isReadOnly) return READ_ONLY_RESULT;
    try {
      const result = await this.service.addPreferenceMemory(params);

      if (!result.success) {
        return { content: result.message, success: false };
      }

      return {
        content: `Preference memory "${params.title}" saved with memoryId: "${result.memoryId}" and preferenceId: "${result.preferenceId}"`,
        state: { memoryId: result.memoryId, preferenceId: result.preferenceId },
        success: true,
      };
    } catch (e) {
      return {
        content: `addPreferenceMemory with error detail: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async updateIdentityMemory(
    params: z.infer<typeof UpdateIdentityActionSchema>,
  ): Promise<BuiltinServerRuntimeOutput> {
    if (this.isReadOnly) return READ_ONLY_RESULT;
    try {
      const result = await this.service.updateIdentityMemory(params);

      if (!result.success) {
        return { content: result.message, success: false };
      }

      return {
        content: `Identity memory updated: ${params.id}`,
        state: { identityId: params.id },
        success: true,
      };
    } catch (e) {
      return {
        content: `updateIdentityMemory with error detail: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async removeIdentityMemory(
    params: z.infer<typeof RemoveIdentityActionSchema>,
  ): Promise<BuiltinServerRuntimeOutput> {
    if (this.isReadOnly) return READ_ONLY_RESULT;
    try {
      const result = await this.service.removeIdentityMemory(params);

      if (!result.success) {
        return { content: result.message, success: false };
      }

      return {
        content: `Identity memory removed: ${params.id}\nReason: ${params.reason}`,
        state: { identityId: params.id, reason: params.reason },
        success: true,
      };
    } catch (e) {
      return {
        content: `removeIdentityMemory with error detail: ${(e as Error).message}`,
        success: false,
      };
    }
  }
}
