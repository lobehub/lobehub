import { type LobeChatDatabase } from '@lobechat/database';
import { type ChatToolPayload } from '@lobechat/types';
import { detectTruncatedJSON, safeParseJSON } from '@lobechat/utils';
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
    const parsed = safeParseJSON(argsStr);

    // When JSON.parse fails, distinguish a truncated payload (typical when the
    // model's max_tokens budget is exhausted mid-tool-call) from a plain schema
    // violation — otherwise the model sees "required field missing" and retries
    // with the same payload, burning time and tokens on each retry.
    if (parsed === undefined && argsStr) {
      const truncationReason = detectTruncatedJSON(argsStr);
      if (truncationReason) {
        const message =
          `The tool call arguments JSON appears to be truncated (${truncationReason}), ` +
          `likely because the model's max_tokens budget was exhausted ` +
          `(possibly by extended-thinking tokens). ` +
          `Either reduce the size of the content you are about to write, ` +
          `or ask the user to increase the model's max_tokens ` +
          `(and/or disable extended thinking or set a separate thinking budget). ` +
          `Do not retry with the same payload.`;
        log(
          'Detected truncated arguments for %s:%s (%s): %s',
          identifier,
          apiName,
          truncationReason,
          argsStr,
        );
        return {
          content: message,
          error: { code: 'TRUNCATED_ARGUMENTS', message },
          success: false,
        };
      }
    }

    const args = parsed || {};

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
        context: {
          topicId: context.topicId,
        },
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

    // Await runtime in case factory is async
    const runtime = await getServerRuntime(identifier, context);

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
