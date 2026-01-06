import type {
  AddIdentityActionSchema,
  ContextMemoryItemSchema,
  ExperienceMemoryItemSchema,
  PreferenceMemoryItemSchema,
  RemoveIdentityActionSchema,
  UpdateIdentityActionSchema,
} from '@lobechat/memory-user-memory/schemas';
import { BaseExecutor, type BuiltinToolResult, SearchMemoryParams } from '@lobechat/types';
import type { z } from 'zod';

import { userMemoryService } from '@/services/userMemory';

import { MemoryIdentifier } from '../manifest';
import { MemoryApiName } from '../types';

/**
 * Format search results into human-readable summary
 */
const formatSearchResultsSummary = (result: {
  contexts: unknown[];
  experiences: unknown[];
  preferences: unknown[];
}): string => {
  const total = result.contexts.length + result.experiences.length + result.preferences.length;

  if (total === 0) {
    return '🔍 No memories found matching the query.';
  }

  const parts: string[] = [`🔍 Found ${total} memories:`];

  if (result.contexts.length > 0) {
    parts.push(`- ${result.contexts.length} context memories`);
  }
  if (result.experiences.length > 0) {
    parts.push(`- ${result.experiences.length} experience memories`);
  }
  if (result.preferences.length > 0) {
    parts.push(`- ${result.preferences.length} preference memories`);
  }

  return parts.join('\n');
};

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
        content: formatSearchResultsSummary(result),
        state: result,
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
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
        content: `🧠 Context memory saved: "${params.title}"`,
        state: { contextId: result.contextId, memoryId: result.memoryId },
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
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
        content: `🧠 Experience memory saved: "${params.title}"`,
        state: { experienceId: result.experienceId, memoryId: result.memoryId },
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
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
        content: `🧠 Identity memory saved: "${params.title}"`,
        state: { identityId: result.identityId, memoryId: result.memoryId },
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
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
        content: `🧠 Preference memory saved: "${params.title}"`,
        state: { memoryId: result.memoryId, preferenceId: result.preferenceId },
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
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
