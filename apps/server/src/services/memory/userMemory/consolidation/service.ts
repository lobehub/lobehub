import { BRANDING_PROVIDER, ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM } from '@lobechat/const';
import type { ModelRuntime } from '@lobechat/model-runtime';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';

import { getBusinessModelRuntimeHooks } from '@/business/server/model-runtime';
import {
  type ConsolidationContextPlan,
  type ConsolidationRoute,
  type LegacyContextItem,
  UserMemoryConsolidationModel,
} from '@/database/models/userMemory/consolidation';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import type { LobeChatDatabase } from '@/database/type';
import { getServerDefaultFilesConfig } from '@/server/globalConfig';
import {
  type MemoryAgentConfig,
  parseMemoryExtractionConfig,
} from '@/server/globalConfig/parseMemoryExtractionConfig';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { getUserScopedAiProviderRuntimeState } from '@/server/services/aiProviderAccess';
import {
  embedUserMemoryTexts,
  type UserMemoryEmbeddingRuntime,
} from '@/server/services/memory/userMemory/embedding';
import {
  type ProviderKeyVaultMap,
  resolveRuntimeAgentConfig,
} from '@/server/services/memory/userMemory/extract';

import {
  type ClassifiedItem,
  CLASSIFY_SCHEMA,
  CLASSIFY_SYSTEM,
  NORMALIZE_SCHEMA,
  NORMALIZE_SYSTEM,
  ROUTE_SCHEMA,
  ROUTE_SYSTEM,
  type RouteResult,
  type SynthesisResult,
  SYNTHESIZE_SCHEMA,
  SYNTHESIZE_SYSTEM,
} from './prompts';

const log = debug('lobe-server:memory:consolidation');

/** Memories per classification call. */
export const CLASSIFY_BATCH = 20;
/** Memories per synthesis call; larger domains are synthesized in time-ordered chunks. */
export const SYNTH_CHUNK = 40;
/** The online step shows the model this many recalled contexts plus the most recently active. */
const ROUTE_TOP_CONTEXTS = 30;
const ROUTE_RECENT_CONTEXTS = 10;

export interface ConsolidationModelOverride {
  model?: string;
  provider?: string;
}

const subjectNames = (item: LegacyContextItem) =>
  [...(item.associatedSubjects ?? []), ...(item.associatedObjects ?? [])]
    .map((s) => s.name)
    .filter((n): n is string => !!n && !['User', 'user', 'Assistant'].includes(n));

export const itemLine = (item: LegacyContextItem, max = 400) =>
  `[${item.id}] ${item.capturedAt.toISOString().slice(0, 10)} | ${item.title ?? ''} | ${(item.description ?? '').slice(0, max)} | 涉及：${subjectNames(item).join('、') || '无'}`;

/** Character-bigram overlap, enough to shortlist contexts for the online step. */
const grams = (text: string) => {
  const t = (text || '').toLowerCase();
  const out = new Map<string, number>();
  for (const w of t.match(/[\da-z]{2,}/g) ?? []) out.set(w, (out.get(w) ?? 0) + 1);
  const han = t.replaceAll(/\P{Script=Han}/gu, '');
  for (let i = 0; i < han.length - 1; i += 1) {
    const g = han.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
};
const overlap = (a: Map<string, number>, b: Map<string, number>) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, v] of a) {
    na += v * v;
    dot += v * (b.get(k) ?? 0);
  }
  for (const v of b.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

export class MemoryConsolidationService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly agentConfig: MemoryAgentConfig;
  private readonly runId: string;
  readonly model: UserMemoryConsolidationModel;
  private runtime?: { model: string; runtime: ModelRuntime };
  private embeddingRuntime?: { model: string; runtime: UserMemoryEmbeddingRuntime };

  constructor(
    db: LobeChatDatabase,
    userId: string,
    runId: string,
    override?: ConsolidationModelOverride,
  ) {
    const { agentConsolidation } = parseMemoryExtractionConfig();
    this.db = db;
    this.userId = userId;
    this.runId = runId;
    this.agentConfig = {
      ...agentConsolidation,
      model: override?.model || agentConsolidation.model,
      provider: override?.provider || agentConsolidation.provider,
    };
    this.model = new UserMemoryConsolidationModel(db, userId);
  }

  private async getRuntime() {
    if (this.runtime) return this.runtime;
    // workspace-audit: intentionally personal-scoped. Memory belongs to the user, so provider
    // access resolves against the user's personal scope, as the persona writer does.
    const aiInfraRepos = new AiInfraRepos(this.db, this.userId, {});
    const runtimeState = await getUserScopedAiProviderRuntimeState(
      this.userId,
      () => aiInfraRepos.getAiProviderRuntimeState(KeyVaultsGateKeeper.getUserKeyVaults),
      { throwOnUnresolvedAccess: true },
    );
    const providerId = await AiInfraRepos.tryMatchingProviderFrom(runtimeState, {
      fallbackProvider: this.agentConfig.provider,
      label: 'memory consolidation',
      modelId: this.agentConfig.model,
    });
    const keyVaults = Object.entries(runtimeState.runtimeConfig || {}).reduce<ProviderKeyVaultMap>(
      (acc, [provider, config]) => {
        acc[provider.toLowerCase()] = config?.keyVaults;
        return acc;
      },
      {},
    );
    const runtime = await resolveRuntimeAgentConfig(
      this.agentConfig,
      keyVaults,
      {
        fallback: { apiKey: this.agentConfig.apiKey, baseURL: this.agentConfig.baseURL },
        preferred: { providerIds: [providerId] },
        userId: this.userId,
      },
      getBusinessModelRuntimeHooks(this.userId, 'lobehub'),
    );
    this.runtime = { model: this.agentConfig.model, runtime };
    return this.runtime;
  }

  private async generate<T>(
    schema: { name: string; schema: Record<string, unknown>; strict: boolean },
    system: string,
    prompt: string,
    stage: string,
  ): Promise<T> {
    const { model, runtime } = await this.getRuntime();
    const started = Date.now();
    const result = await runtime.generateObject(
      {
        messages: [
          { content: system, role: 'system' },
          { content: prompt, role: 'user' },
        ] as never,
        model,
        schema: schema as never,
      },
      {
        metadata: {
          consolidationRunId: this.runId,
          consolidationStage: stage,
          trigger: RequestTrigger.Memory,
        },
      },
    );
    log('%s %s in %dms', this.userId, stage, Date.now() - started);
    return result as T;
  }

  // ---------- backfill ----------

  async classify(ids: string[]): Promise<ClassifiedItem[]> {
    const items = await this.model.getLegacyContextsByIds(ids);
    const order = new Map(ids.map((id, i) => [id, i]));
    items.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    const out = await this.generate<{ items: ClassifiedItem[] }>(
      CLASSIFY_SCHEMA,
      CLASSIFY_SYSTEM,
      items.map((i) => itemLine(i, 420)).join('\n'),
      'classify',
    );
    const got = new Map((out.items ?? []).filter((x) => ids.includes(x.id)).map((x) => [x.id, x]));
    // An item the model skipped is kept in place for the next run rather than guessed.
    return ids.map((id) => got.get(id)).filter((x): x is ClassifiedItem => !!x);
  }

  async normalizeDomains(counts: Record<string, number>): Promise<Record<string, string>> {
    const keys = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (keys.length <= 1) return Object.fromEntries(keys.map(([k]) => [k, k]));
    const out = await this.generate<{ mapping: { domain: string; raw: string }[] }>(
      NORMALIZE_SCHEMA,
      NORMALIZE_SYSTEM,
      keys.map(([k, n]) => `- ${k} (${n})`).join('\n'),
      'normalize',
    );
    const map: Record<string, string> = {};
    for (const { domain, raw } of out.mapping ?? []) map[raw] = domain;
    for (const [k] of keys) map[k] ??= k;
    return map;
  }

  /**
   * Synthesize one chunk of a domain. `existing` is the structure earlier chunks (or earlier runs)
   * built, as plans keyed by synthetic ids, so later chunks can extend it.
   */
  async synthesize(
    label: string,
    ids: string[],
    existingStubs: string[],
  ): Promise<SynthesisResult> {
    const items = await this.model.getLegacyContextsByIds(ids);
    items.sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
    const prompt =
      `领域：${label}\n` +
      (existingStubs.length > 0 ? `已有结构：\n${existingStubs.join('\n')}\n\n` : '') +
      `记忆（按时间）：\n${items.map((i) => itemLine(i, 360)).join('\n')}`;
    const out = await this.generate<SynthesisResult>(
      SYNTHESIZE_SCHEMA,
      SYNTHESIZE_SYSTEM,
      prompt,
      'synthesize',
    );
    return {
      contexts: Array.isArray(out.contexts) ? out.contexts : [],
      unplaced: out.unplaced ?? [],
    };
  }

  // ---------- online (incremental) ----------

  /** Pick route and context for one new memory, showing recalled + recent consolidated contexts. */
  async route(
    item: LegacyContextItem,
    contexts: {
      id: string;
      lastEvidenceAt: Date | null;
      /** Text recall runs on; `text` is what the model is shown. */
      recall: string;
      text: string;
      title: string | null;
    }[],
  ) {
    const q = grams(
      `${item.title ?? ''} ${(item.description ?? '').slice(0, 500)} ${subjectNames(item).join(' ')}`,
    );
    const recalled = [...contexts]
      .map((c) => ({ c, s: overlap(q, grams(c.recall)) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, ROUTE_TOP_CONTEXTS)
      .map((x) => x.c);
    const recent = [...contexts]
      .sort((a, b) => (b.lastEvidenceAt?.getTime() ?? 0) - (a.lastEvidenceAt?.getTime() ?? 0))
      .slice(0, ROUTE_RECENT_CONTEXTS);
    const shown = [...new Map([...recalled, ...recent].map((c) => [c.id, c])).values()];
    const prompt =
      `新记忆（${item.capturedAt.toISOString().slice(0, 10)}）：\n标题：${item.title ?? ''}\n` +
      `内容：${(item.description ?? '').slice(0, 900)}\n涉及：${subjectNames(item).join('、') || '无'}\n\n` +
      `context 列表：\n${shown.map((c) => `- context id=${c.id}：${c.text}`).join('\n') || '（无）'}`;
    const out = await this.generate<RouteResult>(ROUTE_SCHEMA, ROUTE_SYSTEM, prompt, 'route');
    const known = new Set(contexts.map((c) => c.id));
    return { ...out, context: known.has(out.context) ? out.context : 'new' };
  }

  // ---------- writes ----------

  async applyPlan(plan: ConsolidationContextPlan) {
    const descriptionVector = await this.embedDescription(plan.now);
    return this.model.applyContextPlan(this.runId, { ...plan, descriptionVector });
  }

  /**
   * Semantic search ranks contexts by `descriptionVector`, so a synthesized description needs one
   * like the legacy contexts it replaces. Best effort: a failed embedding must not lose the run.
   */
  private async embedDescription(text: string) {
    try {
      if (!this.embeddingRuntime) {
        const { provider, model } =
          getServerDefaultFilesConfig().embeddingModel || DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM;
        const runtime = await initModelRuntimeFromDB(
          this.db,
          this.userId,
          ENABLE_BUSINESS_FEATURES ? BRANDING_PROVIDER : provider,
        );
        this.embeddingRuntime = { model, runtime };
      }
      const [vector] = await embedUserMemoryTexts({
        input: [text],
        model: this.embeddingRuntime.model,
        runtime: this.embeddingRuntime.runtime,
        source: 'memory:consolidation',
        userId: this.userId,
      });
      return vector ?? null;
    } catch (error) {
      log('embedding context description failed: %O', error);
      return null;
    }
  }

  filedContextIds(ids: string[]) {
    return this.model.listFiledContextIds(this.runId, ids);
  }

  markRouted(routes: Record<string, ConsolidationRoute>) {
    return this.model.markRouted(this.runId, routes);
  }
}

/** Turn a synthesis result into context plans, keeping only members from `allowed`. */
export const toContextPlans = (
  result: SynthesisResult,
  allowed: Set<string>,
  knownContexts: Set<string>,
  knownDossiers: Set<string>,
): { plans: ConsolidationContextPlan[]; placed: Set<string> } => {
  const placed = new Set<string>();
  const plans: ConsolidationContextPlan[] = [];
  for (const cx of result.contexts) {
    if (!cx || typeof cx !== 'object' || !Array.isArray(cx.dossiers)) continue;
    const dossiers = cx.dossiers
      .filter((d) => d && Array.isArray(d.members))
      .map((d) => {
        // Synthesis may repeat one evidence id inside a dossier; keep the first occurrence only,
        // otherwise the plan inserts one activity per repetition.
        const memberIds = [...new Set(d.members)].filter((m) => allowed.has(m) && !placed.has(m));
        for (const m of memberIds) placed.add(m);
        return {
          existingDossierId: knownDossiers.has(d.existing_dossier) ? d.existing_dossier : undefined,
          memberIds,
          now: d.now ?? '',
          title: d.title || 'Untitled',
        };
      })
      .filter((d) => d.memberIds.length > 0);
    if (dossiers.length === 0) continue;
    plans.push({
      dossiers,
      existingContextId: knownContexts.has(cx.existing_context) ? cx.existing_context : undefined,
      nextSteps: Array.isArray(cx.next_steps) ? cx.next_steps : [],
      now: cx.now ?? '',
      openQuestions: Array.isArray(cx.open_questions) ? cx.open_questions : [],
      title: cx.title || 'Untitled',
    });
  }
  return { placed, plans };
};
