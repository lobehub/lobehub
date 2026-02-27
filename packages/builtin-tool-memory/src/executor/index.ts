import type {
  ActivityMemoryItemSchema,
  AddIdentityActionSchema,
  ContextMemoryItemSchema,
  ExperienceMemoryItemSchema,
  PreferenceMemoryItemSchema,
  RemoveIdentityActionSchema,
  UpdateIdentityActionSchema,
} from '@lobechat/memory-user-memory/schemas';
import type { BuiltinToolContext, BuiltinToolResult, SearchMemoryParams } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';
import type { z } from 'zod';

import { userMemoryService } from '@/services/userMemory';
import { getAgentStoreState } from '@/store/agent';
import { agentChatConfigSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';

import { MemoryExecutionRuntime } from '../ExecutionRuntime';
import { MemoryIdentifier } from '../manifest';
import { MemoryApiName } from '../types';

class MemoryExecutor extends BaseExecutor<typeof MemoryApiName> {
  readonly identifier = MemoryIdentifier;
  protected readonly apiEnum = MemoryApiName;

  private runtime: MemoryExecutionRuntime;

  constructor() {
    super();
    this.runtime = new MemoryExecutionRuntime({ service: userMemoryService });
  }

  private resolveToolPermission = (agentId?: string): 'read-only' | 'read-write' => {
    const state = getAgentStoreState();
    if (!state) return 'read-write';

    const chatConfig = agentId
      ? chatConfigByIdSelectors.getChatConfigById(agentId)(state)
      : agentChatConfigSelectors.currentChatConfig(state);

    return chatConfig?.memory?.toolPermission === 'read-only' ? 'read-only' : 'read-write';
  };

  private ensureWritable = (agentId?: string) => {
    if (this.resolveToolPermission(agentId) === 'read-only') {
      throw new Error('Memory tool is in read-only mode for this chat');
    }
  };

  private resolveMemoryEffort = (agentId?: string): 'high' | 'low' | 'medium' | undefined => {
    const state = getAgentStoreState();
    if (!state) return undefined;

    const chatConfig = agentId
      ? chatConfigByIdSelectors.getChatConfigById(agentId)(state)
      : agentChatConfigSelectors.currentChatConfig(state);

    return chatConfig?.memory?.effort;
  };

  searchUserMemory = async (
    params: SearchMemoryParams,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.searchUserMemory({
      ...params,
      effort: this.resolveMemoryEffort(ctx?.agentId),
    });
  };

  addContextMemory = async (
    params: z.infer<typeof ContextMemoryItemSchema>,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    this.ensureWritable(ctx?.agentId);
    return this.runtime.addContextMemory(params);
  };

  addActivityMemory = async (
    params: z.infer<typeof ActivityMemoryItemSchema>,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    this.ensureWritable(ctx?.agentId);
    return this.runtime.addActivityMemory(params);
  };

  addExperienceMemory = async (
    params: z.infer<typeof ExperienceMemoryItemSchema>,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    this.ensureWritable(ctx?.agentId);
    return this.runtime.addExperienceMemory(params);
  };

  addIdentityMemory = async (
    params: z.infer<typeof AddIdentityActionSchema>,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    this.ensureWritable(ctx?.agentId);
    return this.runtime.addIdentityMemory(params);
  };

  addPreferenceMemory = async (
    params: z.infer<typeof PreferenceMemoryItemSchema>,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    this.ensureWritable(ctx?.agentId);
    return this.runtime.addPreferenceMemory(params);
  };

  updateIdentityMemory = async (
    params: z.infer<typeof UpdateIdentityActionSchema>,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    this.ensureWritable(ctx?.agentId);
    return this.runtime.updateIdentityMemory(params);
  };

  removeIdentityMemory = async (
    params: z.infer<typeof RemoveIdentityActionSchema>,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    this.ensureWritable(ctx?.agentId);
    return this.runtime.removeIdentityMemory(params);
  };
}

export const memoryExecutor = new MemoryExecutor();
