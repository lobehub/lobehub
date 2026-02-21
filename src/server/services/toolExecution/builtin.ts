import { type LobeChatDatabase } from '@lobechat/database';
import { type ChatToolPayload } from '@lobechat/types';
import { safeParseJSON } from '@lobechat/utils';
import debug from 'debug';

import { KlavisService } from '@/server/services/klavis';
import { MarketService } from '@/server/services/market';

import { getServerRuntime, hasServerRuntime } from './serverRuntimes';
import { type IToolExecutor, type ToolExecutionContext, type ToolExecutionResult } from './types';

const log = debug('lobe-server:builtin-tools-executor');

export class BuiltinToolsExecutor implements IToolExecutor {
  private marketService: MarketService;
  private klavisService: KlavisService;

  constructor(db: LobeChatDatabase, userId: string) {
    this.marketService = new MarketService({ userInfo: { userId } });
    this.klavisService = new KlavisService({ db, userId });
  }

  async execute(
    payload: ChatToolPayload,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { identifier, apiName, arguments: argsStr, source } = payload;
    const args = safeParseJSON(argsStr) || {};

    log(
      'Executing builtin tool: %s:%s (source: %s) with args: %O',
      identifier,
      apiName,
      source,
      args,
    );

    // Route LobeHub Skills to MarketService
    if (source === 'lobehubSkill') {
      return this.marketService.executeLobehubSkill({
        args,
        provider: identifier,
        toolName: apiName,
      });
    }

    // Route Klavis tools to KlavisService
    if (source === 'klavis') {
      return this.klavisService.executeKlavisTool({
        args,
        identifier,
        toolName: apiName,
      });
    }

    // Use server runtime registry (handles both pre-instantiated and per-request runtimes)
    if (!hasServerRuntime(identifier)) {
      throw new Error(`Builtin tool "${identifier}" is not implemented`);
    }

    const runtime = getServerRuntime(identifier, context);

    if (!runtime[apiName]) {
      throw new Error(`Builtin tool ${identifier}'s ${apiName} is not implemented`);
    }

    try {
      return await runtime[apiName](args, context);
    } catch (e) {
      const error = e as Error;
      console.error('Error executing builtin tool %s:%s: %O', identifier, apiName, error);

      return { content: error.message, error, success: false };
    }
  }
}
