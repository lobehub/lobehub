import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { WebBrowsingExecutionRuntime } from '@lobechat/builtin-tool-web-browsing/executionRuntime';
import { type LobeChatDatabase } from '@lobechat/database';
import { type ChatToolPayload } from '@lobechat/types';
import { safeParseJSON } from '@lobechat/utils';
import debug from 'debug';

import { MarketService } from '@/server/services/market';
import { SearchService } from '@/server/services/search';

import { type IToolExecutor, type ToolExecutionResult } from './types';

const log = debug('lobe-server:builtin-tools-executor');

const BuiltinToolServerRuntimes: Record<string, any> = {
  [WebBrowsingManifest.identifier]: WebBrowsingExecutionRuntime,
};

export class BuiltinToolsExecutor implements IToolExecutor {
  private marketService: MarketService;

  constructor(db: LobeChatDatabase, userId: string) {
    this.marketService = new MarketService({ userInfo: { userId } });
  }
  async execute(payload: ChatToolPayload): Promise<ToolExecutionResult> {
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

    // Default: original builtin runtime logic
    const ServerRuntime = BuiltinToolServerRuntimes[identifier];

    if (!ServerRuntime) {
      throw new Error(`Builtin tool "${identifier}" is not implemented`);
    }

    const runtime = new ServerRuntime({
      searchService: new SearchService(),
    });

    if (!runtime[apiName]) {
      throw new Error(`Builtin tool ${identifier} 's ${apiName} is not implemented`);
    }

    try {
      return await runtime[apiName](args);
    } catch (e) {
      const error = e as Error;
      console.error('Error executing builtin tool %s:%s: %O', identifier, apiName, error);

      return { content: error.message, error: error, success: false };
    }
  }
}
