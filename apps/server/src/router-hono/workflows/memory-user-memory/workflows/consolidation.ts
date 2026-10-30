import { type WorkflowContext } from '@upstash/workflow';
import { z } from 'zod';

import {
  type ConsolidationRoute,
  UserMemoryConsolidationModel,
} from '@/database/models/userMemory/consolidation';
import { getServerDB } from '@/database/server';
import {
  CLASSIFY_BATCH,
  MemoryConsolidationService,
  SYNTH_CHUNK,
  toContextPlans,
} from '@/server/services/memory/userMemory/consolidation/service';
import { runStep } from '@/server/workflows/step';

import { checkGuard, ensureWorkflowStarted } from './runGuard';

const WORKFLOW_PATH = 'api/workflows/memory-user-memory/pipelines/consolidation/run';
const ROUTE_BATCH = 10;

const payloadSchema = z.object({
  /** `revert` undoes the run `revertRunId` instead of consolidating. */
  action: z.enum(['run', 'revert']).optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  revertRunId: z.string().optional(),
  userId: z.string().min(1),
});

const STEP = 'memory:pipelines:consolidation';

/**
 * Consolidates one user's memory into contexts and dossiers.
 *
 * - backfill (the user has no consolidated context yet): classify every legacy per-topic context,
 *   normalize domain keys, then synthesize each domain into contexts + dossiers in time-ordered
 *   chunks, writing as it goes.
 * - incremental (afterwards): route each new legacy context to a consolidated context (or a new
 *   one), then synthesize each touched context with its existing dossiers.
 *
 * Decisions travel through the database (`consolidationQueue` on the legacy rows), so step results
 * stay small; every write carries the workflow run id and can be reverted.
 */
export const consolidationHandler = async (context: WorkflowContext) => {
  await ensureWorkflowStarted(context, WORKFLOW_PATH);
  const empty = { contexts: 0, mode: 'none' as const, processed: 0 };
  const entry = await checkGuard(context, WORKFLOW_PATH, { response: empty });
  if (!entry.result) return entry.response;

  const payload = await runStep(context, `${STEP}:parse-payload`, () =>
    payloadSchema.parse(context.requestPayload || {}),
  );
  const runId = context.workflowRunId;
  const db = await getServerDB();

  if (payload.action === 'revert') {
    // Return rather than throw: a throw makes Upstash retry a request that can never succeed.
    if (!payload.revertRunId)
      return { ...empty, error: 'revertRunId is required', mode: 'revert' as const };
    const revertRunId = payload.revertRunId;
    const reverted = await runStep(context, `${STEP}:revert`, () =>
      new UserMemoryConsolidationModel(db, payload.userId).revertRun(revertRunId),
    );
    return { ...empty, mode: 'revert' as const, reverted, revertRunId };
  }

  const service = () =>
    new MemoryConsolidationService(db, payload.userId, runId, {
      model: payload.model,
      provider: payload.provider,
    });

  const pending = await runStep(context, `${STEP}:list-pending`, async () => {
    const s = service();
    const [items, consolidated] = await Promise.all([
      s.model.listPendingLegacyContexts(),
      s.model.listConsolidated(),
    ]);
    return {
      ids: items.map((i) => i.id),
      mode: consolidated.contexts.length === 0 ? ('backfill' as const) : ('incremental' as const),
    };
  });
  if (pending.ids.length === 0) return { ...empty, mode: pending.mode };

  // ---------- stage 1: decide route + queue key ----------
  if (pending.mode === 'backfill') {
    const domainCounts: Record<string, number> = {};
    for (let i = 0; i < pending.ids.length; i += CLASSIFY_BATCH) {
      const batch = pending.ids.slice(i, i + CLASSIFY_BATCH);
      const counts = await runStep(context, `${STEP}:classify:${i / CLASSIFY_BATCH}`, async () => {
        const s = service();
        const items = await s.classify(batch);
        await s.model.enqueue(
          runId,
          items.map((x) => ({ id: x.id, key: x.domain || 'misc', route: x.route })),
        );
        const routed: Record<string, ConsolidationRoute> = {};
        for (const x of items) if (x.route !== 'evidence') routed[x.id] = x.route;
        await s.markRouted(routed);
        const out: Record<string, number> = {};
        for (const x of items)
          if (x.route === 'evidence') out[x.domain || 'misc'] = (out[x.domain || 'misc'] ?? 0) + 1;
        return out;
      });
      for (const [k, n] of Object.entries(counts)) domainCounts[k] = (domainCounts[k] ?? 0) + n;
    }
    const domainMap = await runStep(context, `${STEP}:normalize`, () =>
      service().normalizeDomains(domainCounts),
    );

    const groups = await runStep(context, `${STEP}:group`, async () => {
      const queued = await service().model.listQueued(runId);
      const out: Record<string, string[]> = {};
      for (const q of queued) (out[domainMap[q.key] ?? q.key] ??= []).push(q.id);
      return out;
    });

    let contexts = 0;
    for (const [d, [domain, ids]] of Object.entries(groups).entries()) {
      let domainContexts: string[] = [];
      for (let c = 0; c * SYNTH_CHUNK < ids.length; c += 1) {
        const chunk = ids.slice(c * SYNTH_CHUNK, (c + 1) * SYNTH_CHUNK);
        const known = domainContexts;
        const res = await runStep(context, `${STEP}:synthesize:${d}:${c}`, () =>
          synthesizeAndApply(service(), domain, chunk, known),
        );
        domainContexts = [...new Set([...domainContexts, ...res.contextIds])];
      }
      contexts += domainContexts.length;
    }
    return { contexts, mode: 'backfill', processed: pending.ids.length, runId };
  }

  for (let i = 0; i < pending.ids.length; i += ROUTE_BATCH) {
    const batch = pending.ids.slice(i, i + ROUTE_BATCH);
    await runStep(context, `${STEP}:route:${i / ROUTE_BATCH}`, async () => {
      const s = service();
      const [items, consolidated] = await Promise.all([
        s.model.getLegacyContextsByIds(batch),
        s.model.listConsolidated(),
      ]);
      const titles = await s.model.listDossierEvidenceTitles(
        consolidated.dossiers.map((d) => d.id),
        2,
      );
      const dossierTitles = new Map<string, string[]>();
      const recallText = new Map<string, string[]>();
      for (const d of consolidated.dossiers) {
        if (!d.contextId) continue;
        dossierTitles.set(d.contextId, [...(dossierTitles.get(d.contextId) ?? []), d.title ?? '']);
        recallText.set(d.contextId, [
          ...(recallText.get(d.contextId) ?? []),
          d.title ?? '',
          ...(titles[d.id] ?? []),
        ]);
      }
      const candidates = consolidated.contexts.map((c) => ({
        id: c.id,
        lastEvidenceAt: c.lastEvidenceAt,
        recall: `${c.title ?? ''} ${(recallText.get(c.id) ?? []).join(' ')}`,
        text: `${c.title ?? ''} | 档案：${(dossierTitles.get(c.id) ?? []).slice(0, 8).join('；')}`,
        title: c.title,
      }));
      const entries: { id: string; key: string; route: ConsolidationRoute }[] = [];
      const routed: Record<string, ConsolidationRoute> = {};
      for (const item of items) {
        const r = await s.route(item, candidates);
        const key =
          r.context === 'new' ? `new:${r.new_context_title || item.title || item.id}` : r.context;
        entries.push({ id: item.id, key, route: r.route });
        if (r.route !== 'evidence') routed[item.id] = r.route;
      }
      await s.model.enqueue(runId, entries);
      await s.markRouted(routed);
      return entries.length;
    });
  }

  const groups = await runStep(context, `${STEP}:group`, async () => {
    const queued = await service().model.listQueued(runId);
    const out: Record<string, string[]> = {};
    for (const q of queued) (out[q.key] ??= []).push(q.id);
    return out;
  });
  let contexts = 0;
  for (const [g, [key, ids]] of Object.entries(groups).entries()) {
    const isNew = key.startsWith('new:');
    // Later chunks of one group must see the contexts earlier chunks created, as in backfill.
    let groupContexts: string[] = isNew ? [] : [key];
    const touched = new Set<string>();
    for (let c = 0; c * SYNTH_CHUNK < ids.length; c += 1) {
      const chunk = ids.slice(c * SYNTH_CHUNK, (c + 1) * SYNTH_CHUNK);
      const known = groupContexts;
      const res = await runStep(context, `${STEP}:synthesize:${g}:${c}`, () =>
        synthesizeAndApply(service(), isNew ? key.slice(4) : key, chunk, known),
      );
      for (const id of res.contextIds) touched.add(id);
      groupContexts = [...new Set([...groupContexts, ...res.contextIds])];
    }
    contexts += touched.size;
  }
  return { contexts, mode: 'incremental', processed: pending.ids.length, runId };
};

/** One synthesis call plus its writes; `contextIds` are consolidated contexts it may extend. */
const synthesizeAndApply = async (
  s: MemoryConsolidationService,
  label: string,
  chunkIds: string[],
  contextIds: string[],
) => {
  const out = { activities: 0, contextIds: [] as string[], dossiers: 0, unplaced: 0 };
  // A retried step re-reads its chunk: evidence a committed plan already filed drops out here.
  const ids = (await s.model.getLegacyContextsByIds(chunkIds)).map((i) => i.id);
  // ...and the contexts it filed them into stay known, so the rest extends them.
  const filed = ids.length < chunkIds.length ? await s.filedContextIds(chunkIds) : [];
  out.contextIds.push(...filed);
  if (ids.length === 0) return out;
  const knownIds = new Set([...contextIds, ...filed]);

  const consolidated = await s.model.listConsolidated();
  const known = consolidated.contexts.filter((c) => knownIds.has(c.id));
  const dossiers = consolidated.dossiers.filter((d) => d.contextId && knownIds.has(d.contextId));
  const titles = await s.model.listDossierEvidenceTitles(
    dossiers.map((d) => d.id),
    3,
  );
  const stubs = known.flatMap((c) => [
    `context id=${c.id}：${c.title ?? ''}`,
    ...dossiers
      .filter((d) => d.contextId === c.id)
      .map(
        (d) =>
          `  档案 id=${d.id}：${d.title ?? ''}（${d.activityCount} 条，现在：${(d.now ?? '').slice(0, 60)}，近期：${(titles[d.id] ?? []).join('；')}）`,
      ),
  ]);
  const result = await s.synthesize(label, ids, stubs);
  const { placed, plans } = toContextPlans(
    result,
    new Set(ids),
    new Set(known.map((c) => c.id)),
    new Set(dossiers.map((d) => d.id)),
  );
  // When there is a single known context, the model may describe it without echoing its id.
  if (known.length === 1) for (const p of plans) p.existingContextId ??= known[0].id;

  for (const plan of plans) {
    const r = await s.applyPlan(plan);
    out.activities += r.activities;
    out.dossiers += r.dossiersCreated;
    if (r.contextId) out.contextIds.push(r.contextId);
  }
  const unplaced = ids.filter((id) => !placed.has(id));
  if (unplaced.length > 0) {
    // Not part of any ongoing matter: keep the legacy row as it is, but do not route it again.
    await s.markRouted(Object.fromEntries(unplaced.map((id) => [id, 'drop' as const])));
    out.unplaced = unplaced.length;
  }
  return out;
};

export const consolidationWorkflowOptions = {
  flowControl: {
    key: 'memory-user-memory.pipelines.consolidation',
    parallelism: 2,
  },
};
