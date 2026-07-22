import { builtinTools } from '@lobechat/builtin-tools';
import { type LobeChatDatabase } from '@lobechat/database';
import {
  type ChatToolPayload,
  isWorkSkillProvider,
  type WorkRegistrationIntent,
} from '@lobechat/types';
import { detectTruncatedJSON, safeParseJSON } from '@lobechat/utils';
import debug from 'debug';

import { ComposioService } from '@/server/services/composio';
import { MarketService } from '@/server/services/market';

import { getServerRuntime, hasServerRuntime } from './serverRuntimes';
import { type IToolExecutor, type ToolExecutionContext, type ToolExecutionResult } from './types';
import { resolveBuiltinToolWorkIntent } from './workRegistration';

const log = debug('lobe-server:builtin-tools-executor');

/**
 * Declared API names for a builtin tool, read from its manifest — the
 * authoritative source. Runtime instances declare their APIs as prototype
 * methods (`async sendMessage() {}`), which `Object.keys` cannot see, so the
 * manifest, not the instance, is the correct source for a recovery hint.
 */
const getManifestApiNames = (identifier: string): string[] =>
  (builtinTools.find((tool) => tool.identifier === identifier)?.manifest?.api ?? []).map(
    (api) => api.name,
  );

/**
 * Fallback when a manifest isn't available (e.g. a runtime registered without a
 * matching manifest entry): collect callable names across the whole prototype
 * chain — both own arrow-field methods and class prototype methods — which
 * `Object.keys` alone would miss.
 */
const collectRuntimeApiNames = (runtime: Record<string, any>): string[] => {
  const names = new Set<string>();
  for (
    let cur: object | null = runtime;
    cur && cur !== Object.prototype;
    cur = Object.getPrototypeOf(cur)
  ) {
    for (const key of Object.getOwnPropertyNames(cur)) {
      if (key !== 'constructor' && typeof runtime[key] === 'function') names.add(key);
    }
  }
  return [...names];
};

export class BuiltinToolsExecutor implements IToolExecutor {
  private marketService: MarketService;
  private db: LobeChatDatabase;
  private userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
    this.marketService = new MarketService({ userInfo: { userId } });
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
      const result = await this.marketService.executeLobehubSkill({
        args,
        context: {
          topicId: context.topicId,
        },
        provider: identifier,
        timeoutMs: context.executionTimeoutMs,
        toolName: apiName,
      });

      if (result.success && isWorkSkillProvider(identifier)) {
        // Defer Work registration to the agent runtime so the version is written
        // ONCE with its cumulative cost (known only after execution). Carry the
        // UNTRUNCATED payload here: the runtime only sees the truncated
        // `content`, but skill identity (issue/PR url, number, …) lives
        // exclusively in the raw result.
        return {
          ...result,
          workRegistration: {
            args,
            data: safeParseJSON(result.content) ?? result.content,
            provider: identifier,
            toolName: apiName,
            type: 'skill',
          },
        };
      }

      return result;
    }

    // Route Composio tools to ComposioService. Build it request-scoped: agentId
    // and workspaceId live on the per-call context (not known at construction),
    // so a workspace run resolves workspace connectors (LOBE-10891) and a
    // service-account agent runs off its own Composio account
    // (Agent > Workspace/Personal).
    if (source === 'composio') {
      const composioService = new ComposioService({
        db: this.db,
        userId: this.userId,
        workspaceId: context.workspaceId,
      });
      return composioService.executeComposioTool({
        agentId: context.agentId,
        args,
        identifier,
        toolSlug: apiName,
      });
    }

    // Use server runtime registry (handles both pre-instantiated and per-request runtimes)
    if (!hasServerRuntime(identifier)) {
      throw new Error(`Builtin tool "${identifier}" is not implemented`);
    }

    // Await runtime in case factory is async
    const runtime = await getServerRuntime(identifier, context);

    if (typeof runtime[apiName] !== 'function') {
      // An unknown apiName is almost always a model hallucination (calling an
      // API that the tool never declared in its manifest). Return a structured,
      // recoverable error listing the tool's real APIs instead of throwing a
      // hard error the model cannot act on. The throw here also sits outside
      // the try/catch below, so it would otherwise surface as an uncaught
      // failure rather than a tool result.
      //
      // Prefer the manifest's declared API names; most runtimes declare their
      // APIs as prototype methods that `Object.keys(runtime)` cannot see, which
      // would collapse the hint to an empty list. Fall back to a prototype-chain
      // walk only when no manifest is available.
      const manifestApis = getManifestApiNames(identifier);
      const availableApis =
        manifestApis.length > 0 ? manifestApis : collectRuntimeApiNames(runtime);
      const message =
        `Builtin tool "${identifier}" has no API named "${apiName}". ` +
        `Available APIs: ${availableApis.join(', ')}. ` +
        `Do not call APIs that are not listed above.`;
      log('Unknown apiName for %s: %s (available: %o)', identifier, apiName, availableApis);
      return {
        content: message,
        error: { code: 'UNKNOWN_API', message },
        success: false,
      };
    }

    try {
      // Install a sink for runtimes whose Work registration is a side-effect
      // decoupled from the returned result (the agentDocuments runtime emits its
      // intent here instead of writing the version directly).
      let collectedWorkIntent: WorkRegistrationIntent | undefined;
      context.onWorkRegistration = (intent) => {
        collectedWorkIntent = intent;
      };

      const result = await runtime[apiName](args, context);

      // Manifest-driven Work registration: resolve the intent from the API's
      // declarative `work` config + result/args and hand it to the agent
      // runtime, which persists the Work version ONCE with its cumulative cost.
      // Falls back to the intent a runtime emitted via `onWorkRegistration`
      // (documents). No-op unless the API declares a `work` config or emits one.
      //
      // Best-effort: Work-intent resolution is post-hoc bookkeeping over an
      // already-successful tool call, so a bug in the resolver must not turn a
      // succeeded mutation into a reported tool failure. Isolate it from the
      // execution try/catch below and swallow-and-log instead.
      let workRegistration: WorkRegistrationIntent | undefined;
      try {
        workRegistration =
          resolveBuiltinToolWorkIntent(identifier, apiName, { args, result }) ??
          collectedWorkIntent;
      } catch (workError) {
        log(
          'Work registration intent resolution failed for %s:%s: %O',
          identifier,
          apiName,
          workError,
        );
      }

      return workRegistration ? { ...result, workRegistration } : result;
    } catch (e) {
      const error = e as Error;
      console.error('Error executing builtin tool %s:%s: %O', identifier, apiName, error);

      return { content: error.message, error, success: false };
    }
  }
}
