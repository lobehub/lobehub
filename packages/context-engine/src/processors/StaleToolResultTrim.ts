import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    staleToolResultTrim?: {
      byRule: Record<string, number>;
      /** Whether the turn boundary fell inside the provider cache TTL. */
      cacheWarm?: boolean;
      /** Trims an earlier turn accepted, kept so the cached prefix stays byte-stable. */
      carriedMessages?: number;
      /** Estimated gain used by the warm break-even check (skip path only). */
      gainEstimate?: number;
      /** Measured gap between the previous turn's last activity and the trigger. */
      gapMs?: number;
      /** What the trim would have saved (skip path only). */
      potentialSavedChars?: number;
      /** Estimated rewrite cost used by the warm break-even check (skip path only). */
      rewriteCostEstimate?: number;
      savedChars: number;
      skippedReason?: 'warm-cache';
      trimmedMessages: number;
    };
  }
}

const log = debug('context-engine:processor:StaleToolResultTrimProcessor');

export interface StaleToolResultTrimConfig {
  /**
   * Cache read price relative to the plain input price.
   * Defaults to the active provider's policy from `economics`.
   */
  cacheReadPrice?: number;
  /**
   * Provider prompt-cache TTL in ms. A turn whose trigger follows the
   * previous turn's last activity within this window has a warm cache, so
   * trimming is a paid rewrite and goes through the warm break-even check.
   * Defaults to the active provider's policy from `economics`.
   */
  cacheTtlMs?: number;
  /**
   * Cache write price relative to the plain input price.
   * Defaults to the active provider's policy from `economics`.
   */
  cacheWritePrice?: number;
  /**
   * Head chars kept when an old `runCommand` / `getCommandOutput` result is
   * trimmed (the same number of tail chars is also kept).
   * @default 500
   */
  commandKeepChars?: number;
  /**
   * Head chars kept when an old web-browsing search/crawl result is trimmed.
   * @default 1000
   */
  crawlKeepChars?: number;
  /**
   * Cache economics of the active provider (TTL + read/write prices), e.g.
   * from {@link cacheEconomicsForProvider}. Individual `cache*` overrides win.
   * @default ANTHROPIC_CACHE_ECONOMICS
   */
  economics?: CacheEconomics;
  /**
   * Master switch.
   * @default true
   */
  enabled?: boolean;
  /**
   * Chars an image attached to a tool result (`pluginState.images`) counts as in the size gate
   * and the savings estimate. Images are billed per pixel, not per char, so without a weight a
   * history of image reads never clears the gate and dropping them looks like no saving at all.
   * Anthropic bills a ~1000×1000 image at ~1.3k tokens, about 5k chars.
   * @default 5000
   */
  imageCharEquivalent?: number;
  /**
   * Trailing message count that is never trimmed. The model is actively
   * working with the tail of the conversation; trimming there saves little and
   * risks evicting context it is about to use.
   * @default 20
   */
  keepRecentMessages?: number;
  /**
   * Total chars of tool results below which the trim is skipped entirely —
   * small conversations gain nothing and the gate keeps the no-op path cheap.
   * Monotone within a growing history, so it cannot flip the prefix back and
   * forth between requests.
   * @default 100_000
   */
  minTotalToolChars?: number;
  /**
   * Head chars kept when an old `readPage` result is trimmed. Unlike
   * `snapshot` (interaction state that dies with the next navigation),
   * readPage text is source material the model may quote in its final
   * answer, so the lead of the page stays available.
   * @default 1000
   */
  pageTextKeepChars?: number;
  /**
   * Warm-cache break-even: assumed number of remaining LLM steps the current
   * turn will run. The trim fires on a warm cache only when
   * `estimate × saved × readPrice > rewriteDelta × warmSafetyMargin`.
   * Conservative default; real heavy ops run 100+ steps, quick follow-ups 1-5.
   * @default 20
   */
  warmRemainingStepsEstimate?: number;
  /**
   * Multiplier on the rewrite cost in the warm break-even check, absorbing
   * estimation error.
   * @default 1.5
   */
  warmSafetyMargin?: number;
}

interface TrimCandidate {
  content: string;
  index: number;
  rule: string;
}

/** One turn's trim decision, made at its trigger and replayed by every later turn. */
interface TurnPlan {
  /** New trims this turn accepted. */
  accepted: TrimCandidate[];
  cacheWarm?: boolean;
  gapMs?: number;
  /** Set when the warm break-even check rejected this turn's new candidates. */
  skipped?: NonNullable<PipelineContext['metadata']['staleToolResultTrim']>;
}

/**
 * What the turn replay has learned about the closed history so far. Turn
 * boundaries only move forward, so every field grows incrementally and each
 * message is indexed once per request however many turns are replayed.
 */
interface ReplayIndex {
  /** Tool chars (images weighted) in messages [0, scanned), for the size gate. */
  closedToolChars: number;
  lastWriteIndexByPath: Map<string, number>;
  /** Current trim candidates in [0, scanned) that no turn has accepted yet. */
  pending: Map<number, TrimCandidate>;
  /** `rawCharsPrefix[i]` = untrimmed chars (images weighted) of messages [0, i). */
  rawCharsPrefix: number[];
  readWindowsByPath: Map<string, { end: number; index: number; start: number }[]>;
  /** Messages [0, scanned) are indexed. */
  scanned: number;
  /** Chars removed by each trim accepted so far, keyed by message index. */
  trimmedSavedByIndex: Map<number, number>;
  /** Untrimmed readFile windows in [0, scanned) per path, re-derived when a later write or covering re-read arrives. */
  untrimmedReadsByPath: Map<string, { end: number; index: number; start: number }[]>;
}

const LOCAL_SYSTEM = 'lobe-local-system';

const imageCountOf = (message: Message) =>
  (message.pluginState as { images?: unknown[] } | undefined)?.images?.length ?? 0;

const charsOf = (value: unknown): number =>
  typeof value === 'string' ? value.length : value == null ? 0 : JSON.stringify(value).length;

/**
 * Model-visible chars of a message for cache pricing: its content (text or
 * parts) plus the arguments of the tool calls it issued, which reach the
 * provider as `tool_calls[].function.arguments`. A large `writeFile` call is
 * mostly arguments, and leaving them out underprices the rewrite behind it.
 */
const payloadCharsOf = (message: Message): number => {
  let chars = charsOf(message.content);
  for (const tool of (message.tools as { arguments?: unknown }[] | undefined) ?? []) {
    chars += charsOf(tool?.arguments);
  }
  for (const call of (message.tool_calls as { function?: { arguments?: unknown } }[] | undefined) ??
    []) {
    chars += charsOf(call?.function?.arguments);
  }
  return chars;
};
const BROWSER = 'lobe-browser';
const WEB_BROWSING = 'lobe-web-browsing';
const MESSAGE = 'lobe-message';

export interface CacheEconomics {
  /** Cached-read price relative to the plain input price. */
  readPrice: number;
  /** Cache entry lifetime in ms; a turn gap beyond this means the cache is cold. */
  ttlMs: number;
  /** Reprocessing price of an invalidated prefix, relative to plain input. */
  writePrice: number;
}

export const ANTHROPIC_CACHE_ECONOMICS: CacheEconomics = {
  readPrice: 0.1, // cache read = 10% of input
  ttlMs: 300_000, // 5-minute ephemeral TTL, refreshed per hit
  writePrice: 1.25, // cache write = 1.25× input
};

// Cache economics differ per provider; pricing the warmth verdict and the
// break-even gate with the wrong ones either rewrites still-warm prefixes or
// skips worthwhile trims.
const PROVIDER_CACHE_ECONOMICS: Record<string, CacheEconomics> = {
  anthropic: ANTHROPIC_CACHE_ECONOMICS,
  // Anthropic models via Bedrock share the same cache semantics.
  bedrock: ANTHROPIC_CACHE_ECONOMICS,
  deepseek: {
    // Automatic disk context cache: long-lived, hit ≈ 0.25× miss, no write
    // fee — an invalidated prefix just costs a plain input pass.
    readPrice: 0.25,
    ttlMs: 3_600_000,
    writePrice: 1,
  },
  google: {
    // Gemini implicit caching: short TTL, hit ≈ 0.25×, no explicit write fee.
    readPrice: 0.25,
    ttlMs: 300_000,
    writePrice: 1,
  },
  openai: {
    // Automatic prompt caching: short inactivity expiry, hit = 0.5×, no write fee.
    readPrice: 0.5,
    ttlMs: 300_000,
    writePrice: 1,
  },
};

/** Cache economics for a provider id; falls back to Anthropic's (most conservative TTL). */
export const cacheEconomicsForProvider = (provider?: string): CacheEconomics =>
  PROVIDER_CACHE_ECONOMICS[provider ?? ''] ?? ANTHROPIC_CACHE_ECONOMICS;

const READ_APIS = new Set(['readFile']);
const WRITE_APIS = new Set(['writeFile', 'editFile']);
const COMMAND_APIS = new Set(['runCommand', 'getCommandOutput']);
const CRAWL_APIS = new Set(['search', 'crawlSinglePage', 'crawlMultiPages']);
const MESSAGE_READ_APIS = new Set(['readMessages', 'searchMessages']);

interface PluginInfo {
  apiName?: string;
  arguments?: unknown;
  identifier?: string;
}

const getPlugin = (message: Message): PluginInfo | undefined =>
  message.plugin as PluginInfo | undefined;

// On the wire, `plugin.arguments` is the serialized JSON string from the
// model's tool call; older rows and tests may carry the parsed object.
const parseArguments = (args: unknown): Record<string, any> | undefined => {
  if (!args) return undefined;
  if (typeof args === 'object') return args as Record<string, any>;
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args);
      return parsed && typeof parsed === 'object' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
};

// Prefer the structured pluginState (`ReadFileState`/`WriteFileState` carry
// `path`/`loc` as real fields); fall back to parsing the tool-call arguments
// for rows written before the state fields existed.
const pathOf = (message: Message, plugin: PluginInfo | undefined): string | undefined => {
  const fromState = (message.pluginState as { path?: unknown } | undefined)?.path;
  if (typeof fromState === 'string' && fromState.length > 0) return fromState;
  const args = parseArguments(plugin?.arguments);
  const p = args?.path ?? args?.file_path;
  return typeof p === 'string' && p.length > 0 ? p : undefined;
};

const locOf = (message: Message, plugin: PluginInfo | undefined): [number, number] | undefined => {
  const fromState = (message.pluginState as { loc?: unknown } | undefined)?.loc;
  if (Array.isArray(fromState) && fromState.length === 2) {
    return [fromState[0], fromState[1]];
  }
  const loc = parseArguments(plugin?.arguments)?.loc;
  return Array.isArray(loc) && loc.length === 2 ? [loc[0], loc[1]] : undefined;
};

/**
 * The window a readFile call actually returned. An omitted `loc` defaults to
 * the first 200 lines in the service (`readLocalFile` slices `loc ?? [0, 200]`)
 * unless `fullContent` was requested — treating it as an unbounded full-file
 * read would let a later default read claim to cover ranges it never returned.
 */
const effectiveReadWindow = (
  message: Message,
  plugin: PluginInfo | undefined,
): [number, number] => {
  const explicit = locOf(message, plugin);
  if (explicit) return explicit;
  return parseArguments(plugin?.arguments)?.fullContent
    ? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]
    : [0, 200];
};

/**
 * `UIChatMessage.createdAt` is an epoch-milliseconds number on the canonical
 * path; DB dumps and tests carry ISO strings. `Date.parse(number)` coerces to
 * a garbage string and yields NaN, so normalize explicitly.
 */
const toEpochMs = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
};

/**
 * Replaces the bodies of stale tool results with short placeholders at the
 * payload-assembly boundary.
 *
 * Motivation: within one topic, every request replays the full history, and
 * tool results dominate that history (a single readFile of a large file is
 * tens of KB). Once a result is superseded — the file was rewritten since,
 * the page snapshot is ten interactions old — replaying it buys the model
 * nothing, but every caller still pays for it on every step.
 *
 * Cache safety comes from three constraints: trim decisions only depend on
 * the presence of LATER messages, so once trimmed a message trims identically
 * on every later request and the already-trimmed prefix stays byte-stable;
 * the trim never touches messages from the in-flight turn (after the last
 * user message), because every LLM step of a running operation re-runs this
 * pipeline and rewriting the prefix mid-operation would cold the warm prompt
 * cache for every remaining step; and when the turn boundary itself has a
 * warm cache (user followed up within the provider's cache TTL), the trim is
 * a paid rewrite, so it only fires when the savings clear the warm
 * thresholds. Trimming is truly free at cold boundaries — the first turn,
 * or any gap longer than the cache TTL. A trim an earlier turn accepted is
 * kept by every later turn, warm or cold: the warm gate only decides whether
 * to add new trims, never whether to undo old ones.
 *
 * Must run AFTER the flatten processors (assistantGroup / compressedGroup
 * hoist nested tool results into top-level `role: 'tool'` rows with
 * plugin/pluginState re-attached) and BEFORE ToolCallProcessor.
 */
export class StaleToolResultTrimProcessor extends BaseProcessor {
  readonly name = 'StaleToolResultTrimProcessor';

  private config: Required<Omit<StaleToolResultTrimConfig, 'economics' | 'enabled'>> & {
    economics: CacheEconomics;
    enabled: boolean;
  };

  constructor(config: StaleToolResultTrimConfig = {}, options: ProcessorOptions = {}) {
    super(options);
    const economics = config.economics ?? ANTHROPIC_CACHE_ECONOMICS;
    this.config = {
      cacheReadPrice: config.cacheReadPrice ?? economics.readPrice,
      cacheTtlMs: config.cacheTtlMs ?? economics.ttlMs,
      cacheWritePrice: config.cacheWritePrice ?? economics.writePrice,
      commandKeepChars: config.commandKeepChars ?? 500,
      crawlKeepChars: config.crawlKeepChars ?? 1000,
      economics,
      enabled: config.enabled ?? true,
      imageCharEquivalent: config.imageCharEquivalent ?? 5000,
      keepRecentMessages: config.keepRecentMessages ?? 20,
      minTotalToolChars: config.minTotalToolChars ?? 100_000,
      pageTextKeepChars: config.pageTextKeepChars ?? 1000,
      warmRemainingStepsEstimate: config.warmRemainingStepsEstimate ?? 20,
      warmSafetyMargin: config.warmSafetyMargin ?? 1.5,
    };
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (!this.config.enabled) return this.markAsExecuted(context);

    const messages = context.messages;

    // Trims are sticky across turns. The processor is stateless — nothing about
    // a trim is persisted — so the decision every earlier turn made is replayed
    // here from its own boundary, oldest first. Once a turn accepted a trim, the
    // provider cache holds the trimmed bytes, and every later turn must send the
    // same bytes. Before this replay, a warm follow-up whose break-even check
    // failed fell back to the untrimmed history: it meant to keep the warm
    // prefix, but restored the full text of results the previous turn had
    // trimmed and invalidated the cache from the first of them.
    // A turn's decision only reads persisted history up to its own trigger, so
    // the replay reproduces it exactly from the current history.
    //
    // Virtual tail user messages (`meta.virtualLastUser`, e.g. TodoInjector) are
    // re-created at the end of the payload on every step and never persist, so
    // they are not turn triggers: counting one would move the boundary on every
    // step of a running operation.
    const userIndexes = messages.flatMap((m, i) =>
      m.role === 'user' && m.meta?.virtualLastUser !== true ? [i] : [],
    );
    const turnTriggers = userIndexes.length > 0 ? userIndexes : [-1];

    const rawCharsPrefix = [0];
    for (const m of messages) {
      rawCharsPrefix.push(
        rawCharsPrefix.at(-1)! +
          payloadCharsOf(m) +
          imageCountOf(m) * this.config.imageCharEquivalent,
      );
    }
    const replay: ReplayIndex = {
      closedToolChars: 0,
      lastWriteIndexByPath: new Map(),
      rawCharsPrefix,
      readWindowsByPath: new Map(),
      scanned: 0,
      trimmedSavedByIndex: new Map(),
      pending: new Map(),
      untrimmedReadsByPath: new Map(),
    };

    const trimmed = new Map<number, TrimCandidate>();
    let current: TurnPlan | undefined;
    for (const lastUserIndex of turnTriggers) {
      current = this.planTurn(messages, lastUserIndex, replay);
      if (current.accepted.length === 0) continue;
      for (const candidate of current.accepted) {
        trimmed.set(candidate.index, candidate);
        replay.pending.delete(candidate.index);
        replay.trimmedSavedByIndex.set(
          candidate.index,
          this.savedCharsOf(messages[candidate.index], candidate),
        );
      }
      for (const [path, reads] of replay.untrimmedReadsByPath) {
        replay.untrimmedReadsByPath.set(
          path,
          reads.filter((read) => !trimmed.has(read.index)),
        );
      }
    }

    const carriedMessages = trimmed.size - (current?.accepted.length ?? 0);
    if (trimmed.size === 0) {
      if (!current?.skipped) return this.markAsExecuted(context);
      const skipped = this.cloneContext(context);
      skipped.metadata.staleToolResultTrim = current.skipped;
      return this.markAsExecuted(skipped);
    }

    const clonedContext = this.cloneContext(context);
    let savedChars = 0;
    const byRule: Record<string, number> = {};

    clonedContext.messages = clonedContext.messages.map((message, index) => {
      const candidate = trimmed.get(index);
      if (!candidate) return message;

      savedChars += this.savedCharsOf(message, candidate);
      byRule[candidate.rule] = (byRule[candidate.rule] ?? 0) + 1;
      // A trimmed image read must not keep its attachments: MessageContentProcessor
      // (later in the pipeline) would still turn pluginState.images into
      // model-visible image_url parts, billing the stale image while the text
      // claims the result was trimmed.
      const pluginState = (message.pluginState as { images?: unknown } | undefined)?.images
        ? { ...(message.pluginState as Record<string, unknown>), images: undefined }
        : message.pluginState;
      return { ...message, content: candidate.content, pluginState };
    });

    log(
      'Trimmed %d stale tool result(s) (%d carried from earlier turns), saved %d chars',
      trimmed.size,
      carriedMessages,
      savedChars,
    );

    clonedContext.metadata.staleToolResultTrim = {
      ...current?.skipped,
      byRule,
      cacheWarm: current?.skipped?.cacheWarm ?? current?.cacheWarm,
      carriedMessages,
      gapMs: current?.skipped?.gapMs ?? current?.gapMs,
      savedChars,
      trimmedMessages: trimmed.size,
    };
    return this.markAsExecuted(clonedContext);
  }

  private savedCharsOf(message: Message, candidate: TrimCandidate): number {
    return (
      (message.content as string).length -
      candidate.content.length +
      imageCountOf(message) * this.config.imageCharEquivalent
    );
  }

  /** Re-derive whether the closed-history tool row at `index` is a trim candidate now. */
  private refreshCandidate(messages: Message[], index: number, replay: ReplayIndex): void {
    replay.pending.delete(index);
    const message = messages[index];
    if (typeof message.content !== 'string' || message.content.length === 0) return;
    // Error results are the most valuable debugging context — never trim.
    if (message.pluginError) return;

    const replacement = this.trimMessage(
      message,
      index,
      replay.lastWriteIndexByPath,
      replay.readWindowsByPath,
    );
    if (replacement === undefined || replacement.content === message.content) return;
    // Never admit a replacement that grows the payload — a result barely over
    // the keep threshold would come back longer once the notice is appended.
    // Image reads are exempt: the dropped attachment dwarfs any notice.
    const hasImages =
      ((message.pluginState as { images?: unknown[] } | undefined)?.images?.length ?? 0) > 0;
    if (!hasImages && replacement.content.length >= message.content.length) return;
    replay.pending.set(index, { content: replacement.content, index, rule: replacement.rule });
  }

  /**
   * Decide which NEW trims the turn triggered by `messages[lastUserIndex]`
   * accepts, given the trims earlier turns already applied (tracked in `replay`).
   */
  private planTurn(messages: Message[], lastUserIndex: number, replay: ReplayIndex): TurnPlan {
    // Turn boundary: the last user message starts the in-flight turn. Every
    // LLM step of a running operation re-assembles the payload and re-runs
    // this pipeline, so the trim set must be FROZEN for the whole turn —
    // anything that changes it mid-operation rewrites the prefix and colds
    // the warm prompt cache for every remaining step. Three moving parts are
    // pinned accordingly:
    //
    // 1. The recency window is derived from the turn boundary, not the
    //    growing message count: the protected tail is the K messages before
    //    the trigger plus the entire in-flight turn. `messages.length - K`
    //    would advance as the op appends, letting old results cross the
    //    cutoff mid-operation.
    // 2. The supersede index (pass 1) only covers the closed history before
    //    the boundary: an in-flight write must not retroactively trim
    //    pre-boundary reads mid-operation. It takes effect at the next turn
    //    boundary instead.
    // 3. The minimum-size gate is measured on the closed history only:
    //    counting in-flight tool output would let the gate trip mid-turn as
    //    the op appends results, activating trims that were off at the
    //    boundary.
    //
    // When no user message exists (tests, exotic flows), the recency window
    // alone applies.
    const none: TurnPlan = { accepted: [] };
    const boundary =
      lastUserIndex >= 0
        ? Math.max(0, lastUserIndex + 1 - this.config.keepRecentMessages)
        : Math.max(0, messages.length - this.config.keepRecentMessages);

    // Pass 1 — extend the index of the closed history up to this boundary.
    // Boundaries only move forward across turns, so each message is indexed
    // once per request no matter how many turns are replayed:
    // - tool chars for the minimum-size gate
    // - writes per file path (any writeFile/editFile result row marks a write)
    // - read windows per path, to find reads fully covered by a later re-read
    // Failed results index nothing: a failed write did not supersede anything,
    // a failed read covers nothing.
    const firstNew = replay.scanned;
    // Earlier untrimmed reads whose candidacy the newly indexed events change.
    const affected = new Set<number>();
    for (let index = firstNew; index < boundary; index++) {
      const m = messages[index];
      if (m.role !== 'tool') continue;
      if (typeof m.content === 'string') replay.closedToolChars += m.content.length;
      replay.closedToolChars += imageCountOf(m) * this.config.imageCharEquivalent;

      if (m.pluginError) continue;
      const plugin = getPlugin(m);
      if (plugin?.identifier !== LOCAL_SYSTEM) continue;

      const path = pathOf(m, plugin);
      if (!path) continue;

      const earlierReads = replay.untrimmedReadsByPath.get(path) ?? [];
      if (WRITE_APIS.has(plugin.apiName ?? '')) {
        replay.lastWriteIndexByPath.set(path, index);
        // A write supersedes every earlier read of the path, even one already
        // pending as covered by a re-read (the write rule takes precedence).
        for (const read of earlierReads) {
          if (replay.pending.get(read.index)?.rule !== 'readSupersededByWrite') {
            affected.add(read.index);
          }
        }
      } else if (READ_APIS.has(plugin.apiName ?? '')) {
        const loc = effectiveReadWindow(m, plugin);
        const window = { end: loc[1], index, start: loc[0] };
        const windows = replay.readWindowsByPath.get(path) ?? [];
        windows.push(window);
        replay.readWindowsByPath.set(path, windows);
        // A re-read only changes the earlier reads it fully covers; one that is
        // already pending stays superseded either way.
        for (const read of earlierReads) {
          if (
            !replay.pending.has(read.index) &&
            window.start <= read.start &&
            window.end >= read.end
          ) {
            affected.add(read.index);
          }
        }
        earlierReads.push(window);
        replay.untrimmedReadsByPath.set(path, earlierReads);
      }
    }
    replay.scanned = Math.max(replay.scanned, boundary);

    // Pass 2 — keep the pending candidate set current (dry run; the
    // cache-warmth gate below needs the total savings before deciding).
    // A row's candidacy only changes when it enters the closed history, or —
    // for a readFile — when a later write or covering re-read of the same path
    // does, so only those rows are re-derived. Rows an earlier turn trimmed
    // are gone from the pending set and keep that turn's replacement, so the
    // placeholder stays byte-identical even when a later event would now pick
    // a different rule for it.
    for (const index of affected) {
      if (index < firstNew) this.refreshCandidate(messages, index, replay);
    }
    for (let index = firstNew; index < boundary; index++) {
      if (messages[index].role === 'tool') this.refreshCandidate(messages, index, replay);
    }

    if (replay.closedToolChars < this.config.minTotalToolChars) return none;

    const candidates = [...replay.pending.values()];

    if (candidates.length === 0) return none;

    // Cache-warmth gate. Trimming is free only when the prompt cache is cold —
    // i.e. the gap between the previous turn's last activity and this turn's
    // trigger exceeds the provider's cache TTL (Anthropic: 5 min, refreshed
    // per hit). When the user follows up within the TTL, the cached prefix
    // (with earlier turns' trims applied) would still hit, so the new trims
    // must clear a break-even check against the rewrite they cause:
    //
    //   gain = R_est × S × readPrice   (each remaining step reads S less)
    //   cost = ((Q − S) × writePrice − Q × readPrice) × margin
    //
    // Q is the span the trims rewrite: from the first new candidate up to the
    // trigger, with earlier turns' trims applied (that is what the cache
    // holds). The prefix before it stays cached, and the trigger and everything
    // after it are written in either case.
    //
    // Thanks to determinism the rewrite is paid at most once per trim-set
    // change, not per follow-up — but a warm quick-question turn (1-5 steps)
    // would never recoup it, which is exactly what the check blocks. The gap,
    // the candidates, and the priced payload are all frozen at the turn
    // boundary, so the decision cannot flip mid-operation and flip the
    // prefix with it.
    // A trimmed result also loses its images (pass 3), which is most of the saving for an
    // image read.
    const potentialSavedChars = candidates.reduce(
      (s, c) => s + this.savedCharsOf(messages[c.index], c),
      0,
    );
    const triggeredAt = toEpochMs(messages[lastUserIndex]?.createdAt);
    const prevActivityAt = toEpochMs(messages[lastUserIndex - 1]?.createdAt);
    const gapMs =
      triggeredAt !== undefined && prevActivityAt !== undefined
        ? triggeredAt - prevActivityAt
        : undefined;
    const cacheWarm = gapMs !== undefined && gapMs <= this.config.cacheTtlMs;

    if (cacheWarm) {
      // Q only covers persisted history strictly between the first candidate
      // and the trigger, so later turns replaying this decision price exactly
      // the same bytes. Send-time context never lands there: injectors write
      // into the head (system prompt, document index), the trigger itself
      // (e.g. an active-document snapshot appended to the last user message),
      // or after it. Pricing the whole payload let a large one-turn injection
      // skip a trim that the next turn's replay, no longer seeing it, accepted —
      // trimming bytes the cache still held in full. The span is also frozen at
      // the turn boundary, so in-flight output cannot flip the decision
      // mid-operation.
      const firstCandidate = Math.min(...candidates.map((c) => c.index));
      let trimmedInSpan = 0;
      for (const [index, saved] of replay.trimmedSavedByIndex) {
        if (index >= firstCandidate && index < lastUserIndex) trimmedInSpan += saved;
      }
      const totalChars =
        replay.rawCharsPrefix[lastUserIndex] -
        replay.rawCharsPrefix[firstCandidate] -
        trimmedInSpan;
      const gainEstimate =
        this.config.warmRemainingStepsEstimate * potentialSavedChars * this.config.cacheReadPrice;
      const rewriteCostEstimate =
        (totalChars - potentialSavedChars) * this.config.cacheWritePrice -
        totalChars * this.config.cacheReadPrice;
      const worthwhile = gainEstimate > rewriteCostEstimate * this.config.warmSafetyMargin;
      if (!worthwhile) {
        log(
          'Skipping new trims: cache warm (gap <= %dms), gain %d <= cost %d × %d',
          this.config.cacheTtlMs,
          gainEstimate,
          rewriteCostEstimate,
          this.config.warmSafetyMargin,
        );
        return {
          accepted: [],
          skipped: {
            byRule: {},
            cacheWarm,
            gapMs,
            gainEstimate,
            potentialSavedChars,
            rewriteCostEstimate,
            savedChars: 0,
            skippedReason: 'warm-cache',
            trimmedMessages: 0,
          },
        };
      }
    }

    return { accepted: candidates, cacheWarm, gapMs };
  }

  /** Returns the replacement, or undefined when the message must stay untouched. */
  private trimMessage(
    message: Message,
    index: number,
    lastWriteIndexByPath: Map<string, number>,
    readWindowsByPath: Map<string, { end: number; index: number; start: number }[]>,
  ): { content: string; rule: string } | undefined {
    const plugin = getPlugin(message);
    const identifier = plugin?.identifier;
    const apiName = plugin?.apiName ?? '';
    const content = message.content as string;

    if (identifier === LOCAL_SYSTEM && READ_APIS.has(apiName)) {
      const path = pathOf(message, plugin);
      if (!path) return undefined;

      const writeIndex = lastWriteIndexByPath.get(path);
      if (writeIndex !== undefined && writeIndex > index) {
        return {
          content: `[readFile result trimmed: ${path} — superseded by a later write to this file. Call readFile again if you need the current content.]`,
          rule: 'readSupersededByWrite',
        };
      }

      const loc = effectiveReadWindow(message, plugin);
      const covered = (readWindowsByPath.get(path) ?? []).some(
        (w) => w.index > index && w.start <= loc[0] && w.end >= loc[1],
      );
      if (covered) {
        return {
          content: `[readFile result trimmed: ${path} (lines ${loc[0]}-${loc[1]}) — the same range was read again later. Refer to the newer read, or call readFile again if needed.]`,
          rule: 'readSupersededByRead',
        };
      }
      return undefined;
    }

    if (identifier === BROWSER && apiName === 'snapshot') {
      // Snapshots are interaction state (element refs for clicking) — they die
      // with the next navigation and are pure dead weight afterwards.
      return {
        content: `[browser snapshot result trimmed — stale page state. Take a new snapshot if you need the current page.]`,
        rule: 'staleBrowserPage',
      };
    }

    if (identifier === BROWSER && apiName === 'readPage') {
      // readPage is different: the extracted text is source material the model
      // may quote or summarize in its final answer, not interaction state.
      // Dropping it wholesale can lose the only copy of a source in a long
      // research session — keep a head excerpt like the crawl rules do, so the
      // lead (title, URL, abstract) stays quotable, and say how to re-extract.
      if (content.length <= this.config.pageTextKeepChars) return undefined;
      return {
        content: `${content.slice(0, this.config.pageTextKeepChars)}\n[... trimmed ${content.length - this.config.pageTextKeepChars} chars of an earlier readPage result. Call readPage again on the page if you need the full text.]`,
        rule: 'stalePageText',
      };
    }

    if (identifier === WEB_BROWSING && CRAWL_APIS.has(apiName)) {
      if (content.length <= this.config.crawlKeepChars) return undefined;
      return {
        content: `${content.slice(0, this.config.crawlKeepChars)}\n[... trimmed ${content.length - this.config.crawlKeepChars} chars of stale web-browsing result. Search or crawl again if you need the full content.]`,
        rule: 'staleCrawlResult',
      };
    }

    if (identifier === MESSAGE && MESSAGE_READ_APIS.has(apiName)) {
      // Chat images read from the channel cost vision tokens on every later turn. The text
      // (who said what) stays; the images are dropped once the result leaves the recent window.
      const images = (message.pluginState as { images?: unknown[] } | undefined)?.images;
      if (!images?.length) return undefined;
      return {
        content: `${content}\n[${images.length} image(s) from this ${apiName} result are no longer attached. Call ${apiName} again if you need to see them.]`,
        rule: 'staleMessageImages',
      };
    }

    if (
      identifier === LOCAL_SYSTEM &&
      COMMAND_APIS.has(apiName) &&
      content.length > this.config.commandKeepChars * 2
    ) {
      const head = content.slice(0, this.config.commandKeepChars);
      const tail = content.slice(-this.config.commandKeepChars);
      return {
        content: `${head}\n[... trimmed ${content.length - this.config.commandKeepChars * 2} chars of old command output ...]\n${tail}`,
        rule: 'oldCommandOutput',
      };
    }

    return undefined;
  }
}
