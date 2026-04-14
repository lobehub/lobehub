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

    // When JSON.parse fails, return a dedicated error rather than silently
    // falling back to `{}`. Passing `{}` to the tool produced generic
    // "required field missing" errors, which led the model to retry with the
    // same broken payload. Distinguish a truncated payload (typical when
    // max_tokens is exhausted mid-tool-call) from plain malformed JSON, and
    // echo the raw arguments string so the model can verify it is exactly
    // what it produced.
    if (parsed === undefined && argsStr) {
      const truncationReason = detectTruncatedJSON(argsStr);
      const explanation = truncationReason
        ? `The tool call arguments JSON appears to be truncated (${truncationReason}), ` +
          `likely because the model's max_tokens budget was exhausted ` +
          `(possibly by extended-thinking tokens). ` +
          `Either reduce the size of the content you are about to write, ` +
          `or ask the user to increase the model's max_tokens ` +
          `(and/or disable extended thinking or set a separate thinking budget). ` +
          `Do not retry with the same payload.`
        : `The tool call arguments string is not valid JSON and could not be parsed, ` +
          `so the tool was not invoked. Fix the JSON syntax and try again.`;
      const content = `${explanation}\n\nThe received arguments string was:\n${argsStr}`;
      const code = truncationReason ? 'TRUNCATED_ARGUMENTS' : 'INVALID_JSON_ARGUMENTS';
      log('Rejected invalid arguments for %s:%s (%s): %s', identifier, apiName, code, argsStr);
      return {
        content,
        error: { code, message: explanation },
        success: false,
      };
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
