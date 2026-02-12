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
import type { BuiltinToolResult, SearchMemoryParams } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';
import type { z } from 'zod';

import { userMemoryService } from '@/services/userMemory';

import { MemoryIdentifier } from '../manifest';
import { MemoryApiName } from '../types';

/**
 * Memory Tool Executor
 *
 * Handles all memory-related operations including search, add, update, and remove.
 */
class MemoryExecutor extends BaseExecutor<typeof MemoryApiName> {
  readonly identifier = MemoryIdentifier;
  protected readonly apiEnum = MemoryApiName;

  // ==================== Search API ====================

  /**
   * Search user memories based on query
   */
  searchUserMemory = async (params: SearchMemoryParams): Promise<BuiltinToolResult> => {
    try {
      const result = await userMemoryService.searchMemory(params);

      return {
        content: formatMemorySearchResults({ query: params.query, results: result }),
        state: result,
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: `searchUserMemory with error detail: ${err.message}`,
        error: {
          body: error,
          message: err.message,
          type: 'PluginServerError',
        },
        success: false,
      };
    }
  };

  // ==================== Add APIs ====================

  /**
   * Add a context memory
   */
  addContextMemory = async (
    params: z.infer<typeof ContextMemoryItemSchema>,
  ): Promise<BuiltinToolResult> => {
    try {
      const result = await userMemoryService.addContextMemory(params);

      if (!result.success) {
        return {
          error: {
            message: result.message,
            type: 'PluginServerError',
          },
          success: false,
        };
      }

      return {
        content: `Context memory "${params.title}" saved with memoryId: "${result.memoryId}" and contextId: "${result.contextId}"`,
        state: { contextId: result.contextId, memoryId: result.memoryId },
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: `addContextMemory with error detail: ${err.message}`,
        error: {
          body: error,
          message: err.message,
          type: 'PluginServerError',
        },
        success: false,
      };
    }
  };

  /**
   * Add an activity memory
   */
  addActivityMemory = async (
    params: z.infer<typeof ActivityMemoryItemSchema>,
  ): Promise<BuiltinToolResult> => {
    try {
      const result = await userMemoryService.addActivityMemory(params);

      if (!result.success) {
        return {
          error: {
            message: result.message,
            type: 'PluginServerError',
          },
          success: false,
        };
      }

      return {
        content: `Activity memory "${params.title}" saved with memoryId: "${result.memoryId}" and activityId: "${result.activityId}"`,
        state: { activityId: result.activityId, memoryId: result.memoryId },
        success: true,
      };
    } catch (error) {
      const err = error as Error;

      return {
        content: `addActivityMemory with error detail: ${err.message}`,
        error: {
          body: error,
          message: err.message,
          type: 'PluginServerError',
        },
        success: false,
      };
    }
  };

  /**
   * Add an experience memory
   */
  addExperienceMemory = async (
    params: z.infer<typeof ExperienceMemoryItemSchema>,
  ): Promise<BuiltinToolResult> => {
    try {
      const result = await userMemoryService.addExperienceMemory(params);

      if (!result.success) {
        return {
          error: {
            message: result.message,
            type: 'PluginServerError',
          },
          success: false,
        };
      }

      return {
        content: `Experience memory "${params.title}" saved with memoryId: "${result.memoryId}" and experienceId: "${result.experienceId}"`,
        state: { experienceId: result.experienceId, memoryId: result.memoryId },
        success: true,
      };
    } catch (error) {
      const err = error as Error;

      return {
        content: `addExperienceMemory with error detail: ${err.message}`,
        error: {
          body: error,
          message: err.message,
          type: 'PluginServerError',
        },
        success: false,
      };
    }
  };

  /**
   * Add an identity memory
   */
  addIdentityMemory = async (
    params: z.infer<typeof AddIdentityActionSchema>,
  ): Promise<BuiltinToolResult> => {
    try {
      const result = await userMemoryService.addIdentityMemory(params);

      if (!result.success) {
        return {
          error: {
            message: result.message,
            type: 'PluginServerError',
          },
          success: false,
        };
      }

      return {
        content: `Identity memory "${params.title}" saved with memoryId: "${result.memoryId}" and identityId: "${result.identityId}"`,
        state: { identityId: result.identityId, memoryId: result.memoryId },
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: `addIdentityMemory with error detail: ${err.message}`,
        error: {
          body: error,
          message: err.message,
          type: 'PluginServerError',
        },
        success: false,
      };
    }
  };

  /**
   * Add a preference memory
   */
  addPreferenceMemory = async (
    params: z.infer<typeof PreferenceMemoryItemSchema>,
  ): Promise<BuiltinToolResult> => {
    try {
      const result = await userMemoryService.addPreferenceMemory(params);

      if (!result.success) {
        return {
          error: {
            message: result.message,
            type: 'PluginServerError',
          },
          success: false,
        };
      }

      return {
        content: `Preference memory "${params.title}" saved with memoryId: "${result.memoryId}" and preferenceId: "${result.preferenceId}"`,
        state: { memoryId: result.memoryId, preferenceId: result.preferenceId },
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: `addPreferenceMemory with error detail: ${err.message}`,
        error: {
          body: error,
          message: err.message,
          type: 'PluginServerError',
        },
        success: false,
      };
    }
  };

  // ==================== Update/Remove APIs ====================

  /**
   * Update an identity memory
   */
  updateIdentityMemory = async (
    params: z.infer<typeof UpdateIdentityActionSchema>,
  ): Promise<BuiltinToolResult> => {
    try {
      const result = await userMemoryService.updateIdentityMemory(params);

      if (!result.success) {
        return {
          error: {
            message: result.message,
            type: 'PluginServerError',
          },
          success: false,
        };
      }

      return {
        content: `✏️ Identity memory updated: ${params.id}`,
        state: { identityId: params.id },
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: `updateIdentityMemory with error detail: ${err.message}`,
        error: {
          body: error,
          message: err.message,
          type: 'PluginServerError',
        },
        success: false,
      };
    }
  };

  /**
   * Remove an identity memory
   */
  removeIdentityMemory = async (
    params: z.infer<typeof RemoveIdentityActionSchema>,
  ): Promise<BuiltinToolResult> => {
    try {
      const result = await userMemoryService.removeIdentityMemory(params);

      if (!result.success) {
        return {
          error: { message: result.message, type: 'PluginServerError' },
          success: false,
        };
      }

      return {
        content: `🗑️ Identity memory removed: ${params.id}\nReason: ${params.reason}`,
        state: { identityId: params.id, reason: params.reason },
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: `removeIdentityMemory with error detail: ${err.message}`,
        error: {
          body: error,
          message: err.message,
          type: 'PluginServerError',
        },
        success: false,
      };
    }
  };
}

// Export the executor instance for registration
export const memoryExecutor = new MemoryExecutor();
