/**
 * Seed the built-in Lobe Bench case library as system rows (`user_id IS NULL`): every user
 * sees and runs it, nobody edits it; accounts pick its cases into their own datasets.
 * Reads the library from the bench engine that serves its Release and upserts benchmark,
 * case set, shared environments and cases by identifier, so re-running after a new Release
 * updates rows in place. Cases no longer shipped are retired, preserving historical results.
 *
 *   bun run eval:seed-lobe-bench                       # default: the case library (:7441)
 *   bun run eval:seed-lobe-bench -- --dry-run
 *   bun run eval:seed-lobe-bench -- --set=all-cases:All cases:all293:http://127.0.0.1:7441
 *   bun run eval:seed-lobe-bench -- --include-multi-turn    # keep multi-turn cases
 *   bun run eval:seed-lobe-bench -- --retire-set=benchmark-30
 *       # delete a built-in case set that is no longer shipped, with its runs and results
 *       # (cascade); run it once where that set was seeded before
 *   bun run eval:seed-lobe-bench -- --adopt-from-user=<userId>
 *
 * The library engine's `GET /views` (frozen Pack Releases that pick library cases, e.g.
 * lobe-bench-hard-50) become built-in benchmarks of their own, each made of one system
 * dataset that stores the picked case ids (`metadata.picks`) and runs on the library.
 *       # first turn that user's own "lobe-bench" benchmark, these case sets, their cases and
 *       # environments into system rows (runs and experiments keep pointing at the same ids)
 *
 * The engine URL in `--set` is only where this script reads the case set from (the Release
 * it serves). Where LobeHub forwards tool calls at run time is not seeded: it is the server's
 * deployment configuration (`EVAL_TOOL_MOCK_BASE_URL`, with `EVAL_TOOL_FORWARDING_TOKEN`), and
 * the benchmark only records the mock-side dataset segment and connector presentation. An
 * existing benchmark keeps its judge and experiment defaults.
 */
import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import { and, eq, inArray, isNull, like, sql } from 'drizzle-orm';

import type { EngineCase, EngineService } from './mapping';
import { connectorsOf, describeEnvironment, fingerprint, toCaseRow } from './mapping';

const env = process.env.NODE_ENV || 'development';
dotenvExpand.expand(dotenv.config());
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}` }));
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}.local` }));

interface CaseSet {
  engine: string;
  identifier: string;
  mockDataset: string;
  name: string;
}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const values = (name: string) =>
  args.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
const value = (name: string) => values(name).at(-1);

const parseSet = (spec: string): CaseSet => {
  const [identifier, name, mockDataset, ...rest] = spec.split(':');
  const engine = rest.join(':');
  if (!identifier || !name || !mockDataset || !engine) {
    throw new Error(`--set expects identifier:name:mockDataset:engineUrl, got "${spec}"`);
  }
  return { engine: engine.replace(/\/+$/, ''), identifier, mockDataset, name };
};

// One built-in case library, not several case sets (the 250
// cases are the library accounts pick their datasets from). It is the dataset "All cases" the
// benchmark "Lobe Bench" is made of; the engine's views are further benchmarks, each made
// of a dataset of its cases (Hard 50; a benchmark is made of datasets).
// The identifier stays `all-cases` so its runs and per-case history carry over.
const SETS: CaseSet[] = values('set').length
  ? values('set').map(parseSet)
  : [parseSet('all-cases:All cases:all293:http://127.0.0.1:7441')];
const RETIRE_SETS = values('retire-set');
const DRY_RUN = flag('dry-run');
/**
 * Multi-turn cases (`followUpTurns`): runs play the first turn only, so they are left out
 * until the follow-up turns can be played. `--include-multi-turn` keeps them.
 */
const keepsMultiTurn = (_set: CaseSet) => flag('include-multi-turn') && !flag('exclude-multi-turn');
const ADOPT_FROM_USER = value('adopt-from-user');
const judgeSpec = value('judge') ?? 'openrouter/deepseek/deepseek-v4.1-flash';
const [judgeProvider, ...judgeRest] = judgeSpec.split('/');
const JUDGE = { model: judgeRest.join('/'), provider: judgeProvider };
const BENCHMARK_IDENTIFIER = 'lobe-bench';

const fetchJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
};

interface Health {
  cases: number;
  /** `presentation`: how the engine renders tool results; it changes what a model sees. */
  release: { presentation?: string; version: string };
}

/** A frozen Pack Release that picks cases of the engine's Release (bench-engine `GET /views`). */
interface EngineView {
  caseIds: string[];
  description: string;
  id: string;
  manifestSha256: string;
  name: string;
  version: string;
}

const loadSet = async (set: CaseSet) => {
  const health = await fetchJson<Health>(`${set.engine}/healthz`);
  const [services, cases, views] = await Promise.all([
    fetchJson<EngineService[]>(`${set.engine}/services`),
    fetchJson<EngineCase[]>(`${set.engine}/cases`),
    // Engines older than the views route have none.
    fetchJson<EngineView[]>(`${set.engine}/views`).catch(() => [] as EngineView[]),
  ]);
  if (cases.length !== health.cases) {
    throw new Error(
      `${set.identifier}: engine lists ${cases.length} cases, healthz says ${health.cases}`,
    );
  }
  if (cases.some((c) => !c.agentPrompt)) {
    throw new Error(
      `${set.identifier}: the engine does not serve agentPrompt; update bench-engine`,
    );
  }
  return {
    cases,
    presentation: health.release.presentation,
    release: health.release.version,
    services,
    views,
  };
};

/**
 * Applies the multi-turn policy across the sets: a set that keeps multi-turn cases keeps
 * them all; any other set still keeps the multi-turn cases that a keeping set contains.
 */
const applyMultiTurnPolicy = (loaded: Array<{ cases: EngineCase[]; set: CaseSet }>) => {
  const keptEverywhere = new Set(
    loaded
      .filter(({ set }) => keepsMultiTurn(set))
      .flatMap(({ cases }) => cases.filter((c) => c.followUpTurns?.length).map((c) => c.caseId)),
  );
  return loaded.map((entry) => {
    const multiTurn = entry.cases.filter((c) => c.followUpTurns?.length);
    const kept = keepsMultiTurn(entry.set)
      ? multiTurn
      : multiTurn.filter((c) => keptEverywhere.has(c.caseId));
    const keptIds = new Set(kept.map((c) => c.caseId));
    return {
      ...entry,
      cases: entry.cases.filter((c) => !c.followUpTurns?.length || keptIds.has(c.caseId)),
      excludedMultiTurn: multiTurn.length - kept.length,
      keptMultiTurn: kept.length,
    };
  });
};

const main = async () => {
  const loaded = applyMultiTurnPolicy(
    await Promise.all(SETS.map(async (set) => ({ set, ...(await loadSet(set)) }))),
  );
  for (const { set, cases, excludedMultiTurn, keptMultiTurn, release, views } of loaded) {
    for (const view of views) {
      const missing = view.caseIds.filter((id) => !cases.some((c) => c.caseId === id));
      if (missing.length) {
        throw new Error(
          `${set.identifier}: view ${view.id}@${view.version} picks ${missing.length} case(s) the set does not seed, e.g. ${missing[0]}`,
        );
      }
      console.log(
        `${set.identifier}: view ${view.id}@${view.version}, ${view.caseIds.length} cases`,
      );
    }
    const note = excludedMultiTurn
      ? ` (${excludedMultiTurn} multi-turn left out; --include-multi-turn to seed them)`
      : keptMultiTurn
        ? ` (${keptMultiTurn} multi-turn kept; runs play their first turn only)`
        : '';
    console.log(
      `${set.identifier}: ${cases.length} cases${note}, release ${release} (${set.engine})`,
    );
  }
  const connectors = Object.assign(
    {},
    ...loaded.map(({ cases, services }) => connectorsOf(cases, services)),
  );
  if (DRY_RUN) {
    console.log(
      `dry run: ${Object.keys(connectors).length} connectors, mock dataset ${SETS[0].mockDataset} (address from EVAL_TOOL_MOCK_BASE_URL at run time); nothing written`,
    );
    return;
  }

  const { serverDB } = await import('../../packages/database/src/server');
  const { retireLobeBenchCases } = await import('./retireCases');
  const {
    agentEvalBenchmarks,
    agentEvalDatasets,
    agentEvalEnvironments,
    agentEvalExperiments,
    agentEvalRuns,
    agentEvalTestCases,
  } = await import('../../packages/database/src/schemas');

  await serverDB.transaction(async (tx) => {
    // 0. Adopt one user's own copy as the system copy (ids and run history unchanged).
    if (ADOPT_FROM_USER) {
      const owned = await tx
        .select({ id: agentEvalBenchmarks.id })
        .from(agentEvalBenchmarks)
        .where(
          and(
            eq(agentEvalBenchmarks.identifier, BENCHMARK_IDENTIFIER),
            eq(agentEvalBenchmarks.userId, ADOPT_FROM_USER),
            isNull(agentEvalBenchmarks.workspaceId),
          ),
        );
      const system = await tx
        .select({ id: agentEvalBenchmarks.id })
        .from(agentEvalBenchmarks)
        .where(
          and(
            eq(agentEvalBenchmarks.identifier, BENCHMARK_IDENTIFIER),
            isNull(agentEvalBenchmarks.userId),
          ),
        );
      if (owned.length === 1 && system.length === 0) {
        const benchmarkId = owned[0].id;
        await tx
          .update(agentEvalBenchmarks)
          .set({ isSystem: true, userId: null })
          .where(eq(agentEvalBenchmarks.id, benchmarkId));
        const datasets = await tx
          .select({ id: agentEvalDatasets.id })
          .from(agentEvalDatasets)
          .where(
            and(
              eq(agentEvalDatasets.benchmarkId, benchmarkId),
              eq(agentEvalDatasets.userId, ADOPT_FROM_USER),
              inArray(
                agentEvalDatasets.identifier,
                SETS.map((s) => s.identifier),
              ),
            ),
          );
        const datasetIds = datasets.map((d) => d.id);
        let caseCount = 0;
        let envCount = 0;
        if (datasetIds.length) {
          await tx
            .update(agentEvalDatasets)
            .set({ userId: null })
            .where(inArray(agentEvalDatasets.id, datasetIds));
          const cases = await tx
            .select({ environmentId: agentEvalTestCases.environmentId, id: agentEvalTestCases.id })
            .from(agentEvalTestCases)
            .where(
              and(
                inArray(agentEvalTestCases.datasetId, datasetIds),
                eq(agentEvalTestCases.userId, ADOPT_FROM_USER),
              ),
            );
          caseCount = cases.length;
          if (cases.length) {
            await tx
              .update(agentEvalTestCases)
              .set({ userId: null })
              .where(
                inArray(
                  agentEvalTestCases.id,
                  cases.map((c) => c.id),
                ),
              );
          }
          const envIds = [
            ...new Set(cases.map((c) => c.environmentId).filter(Boolean)),
          ] as string[];
          if (envIds.length) {
            const updated = await tx
              .update(agentEvalEnvironments)
              .set({ userId: null })
              .where(
                and(
                  inArray(agentEvalEnvironments.id, envIds),
                  eq(agentEvalEnvironments.userId, ADOPT_FROM_USER),
                  like(agentEvalEnvironments.identifier, 'env-%'),
                ),
              )
              .returning({ id: agentEvalEnvironments.id });
            envCount = updated.length;
          }
        }
        console.log(
          `adopted from user: benchmark ${benchmarkId}, ${datasetIds.length} case sets, ${caseCount} cases, ${envCount} environments are now system rows`,
        );
      } else {
        console.log(
          `adopt skipped: ${owned.length} owned benchmark(s) named ${BENCHMARK_IDENTIFIER}, ${system.length} system benchmark(s) already`,
        );
      }
    }

    // 1. The benchmark.
    // No address here on purpose: the server resolves it from EVAL_TOOL_MOCK_BASE_URL.
    const mock = { connectors, dataset: SETS[0].mockDataset, timeoutMs: 30_000 };
    const [existingBenchmark] = await tx
      .select()
      .from(agentEvalBenchmarks)
      .where(
        and(
          eq(agentEvalBenchmarks.identifier, BENCHMARK_IDENTIFIER),
          isNull(agentEvalBenchmarks.userId),
        ),
      )
      .limit(1);
    const previous = (existingBenchmark?.metadata ?? {}) as Record<string, unknown>;
    const metadata = {
      ...previous,
      defaults: previous.defaults ?? { k: 1, maxSteps: 20, timeoutMinutes: 15 },
      judge: previous.judge ?? JUDGE,
      kind: 'lobe-bench',
      mock,
    };
    const description =
      'Every case of the built-in case library, run whole: real user tasks across connected services, with per-case persona, tools, Memory and clock. Built in: every account sees it.';
    let benchmarkId: string;
    if (existingBenchmark) {
      benchmarkId = existingBenchmark.id;
      await tx
        .update(agentEvalBenchmarks)
        .set({ description, isSystem: true, metadata, name: 'Lobe Bench', updatedAt: new Date() })
        .where(eq(agentEvalBenchmarks.id, benchmarkId));
    } else {
      const [created] = await tx
        .insert(agentEvalBenchmarks)
        .values({
          description,
          identifier: BENCHMARK_IDENTIFIER,
          isSystem: true,
          metadata,
          name: 'Lobe Bench',
          rubrics: [],
          userId: null,
        })
        .returning({ id: agentEvalBenchmarks.id });
      benchmarkId = created.id;
    }
    const judge = (metadata.judge ?? JUDGE) as Record<string, unknown>;

    // 2. Shared environments known so far (system rows only).
    const systemEnvs = await tx
      .select({ id: agentEvalEnvironments.id, identifier: agentEvalEnvironments.identifier })
      .from(agentEvalEnvironments)
      .where(
        and(isNull(agentEvalEnvironments.userId), like(agentEvalEnvironments.identifier, 'env-%')),
      );
    const envIds = new Map(
      systemEnvs
        .map((e) => [e.identifier?.match(/^env-([\da-f]{10})$/)?.[1], e.id] as const)
        .filter((pair): pair is readonly [string, string] => !!pair[0]),
    );

    for (const { set, cases, presentation, release, services, views } of loaded) {
      // 3. The case set.
      const setConnectors = connectorsOf(cases, services);
      // Release and presentation together are the version of the cases a run records
      // (`evalCaseVersionOf`); leaderboards count only runs on the current one.
      const datasetMetadata = {
        kind: 'lobe-bench',
        mock: { connectors: setConnectors, dataset: set.mockDataset, timeoutMs: 60_000 },
        ...(presentation && { presentation }),
        release,
      };
      const setDescription =
        set.identifier === 'all-cases'
          ? `Every case of the built-in case library: ${cases.length} real user tasks across connected services. Release ${release}.`
          : `${set.name}: ${cases.length} real user tasks across connected services. Release ${release}.`;
      const [existingDataset] = await tx
        .select({ id: agentEvalDatasets.id })
        .from(agentEvalDatasets)
        .where(
          and(
            eq(agentEvalDatasets.benchmarkId, benchmarkId),
            eq(agentEvalDatasets.identifier, set.identifier),
            isNull(agentEvalDatasets.userId),
          ),
        )
        .limit(1);
      let datasetId: string;
      if (existingDataset) {
        datasetId = existingDataset.id;
        await tx
          .update(agentEvalDatasets)
          .set({
            description: setDescription,
            evalConfig: {
              judgePrompt: 'Grade the attempt against the rules of the case.',
              ...judge,
            },
            evalMode: 'rule-checklist',
            metadata: datasetMetadata,
            name: set.name,
            updatedAt: new Date(),
          })
          .where(eq(agentEvalDatasets.id, datasetId));
      } else {
        const [created] = await tx
          .insert(agentEvalDatasets)
          .values({
            benchmarkId,
            description: setDescription,
            evalConfig: {
              judgePrompt: 'Grade the attempt against the rules of the case.',
              ...judge,
            },
            evalMode: 'rule-checklist',
            identifier: set.identifier,
            metadata: datasetMetadata,
            name: set.name,
            userId: null,
          })
          .returning({ id: agentEvalDatasets.id });
        datasetId = created.id;
      }

      // 4. Environments and cases.
      const existingCases = await tx
        .select({ id: agentEvalTestCases.id, metadata: agentEvalTestCases.metadata })
        .from(agentEvalTestCases)
        .where(and(eq(agentEvalTestCases.datasetId, datasetId), isNull(agentEvalTestCases.userId)));
      const byCaseId = new Map(
        existingCases.map(
          (c) => [(c.metadata as { caseId?: string } | null)?.caseId, c.id] as const,
        ),
      );
      let created = 0;
      let updated = 0;
      let envCreated = 0;
      // Each case's row as written here, by case id: a built-in dataset of library cases
      // (Hard 50) holds copies of these rows.
      const caseRows = new Map<string, Record<string, unknown>>();
      for (const c of cases) {
        const row = toCaseRow(c, judge);
        const fp = fingerprint(row.shared);
        let environmentId = envIds.get(fp);
        if (!environmentId) {
          const [createdEnv] = await tx
            .insert(agentEvalEnvironments)
            .values({
              ...describeEnvironment(row.shared),
              config: row.shared,
              identifier: `env-${fp}`,
              metadata: { fingerprint: fp, kind: 'lobe-bench', release, source: set.identifier },
              userId: null,
            })
            .returning({ id: agentEvalEnvironments.id });
          environmentId = createdEnv.id;
          envIds.set(fp, environmentId);
          envCreated += 1;
        }
        const values = {
          content: row.content,
          environmentId,
          evalConfig: row.evalConfig,
          evalMode: row.evalMode,
          metadata: row.metadata,
          sortOrder: row.sortOrder,
        };
        caseRows.set(c.caseId, values);
        const existingId = byCaseId.get(c.caseId);
        if (existingId) {
          await tx
            .update(agentEvalTestCases)
            .set({ ...values, updatedAt: new Date() })
            .where(eq(agentEvalTestCases.id, existingId));
          updated += 1;
        } else {
          await tx.insert(agentEvalTestCases).values({ ...values, datasetId, userId: null });
          created += 1;
        }
      }
      const stale = existingCases
        .filter(
          (c) =>
            !cases.some((x) => x.caseId === (c.metadata as { caseId?: string } | null)?.caseId),
        )
        .map((c) => c.id);
      await retireLobeBenchCases(tx, stale);
      console.log(
        `${set.identifier} (${datasetId}): ${created} cases created, ${updated} updated, ${stale.length} retired (history preserved); ${envCreated} environments created (${envIds.size} known)`,
      );

      // 4b. The engine's views (Hard 50): each a benchmark of its own, made of one dataset
      // that holds copies of its library cases, as an Evaluation Lab dataset holds its
      // cases; runs run that dataset whole.
      for (const view of views) {
        const viewMeta = {
          id: view.id,
          manifestSha256: view.manifestSha256,
          version: view.version,
        };
        const [existingViewBenchmark] = await tx
          .select({ id: agentEvalBenchmarks.id, metadata: agentEvalBenchmarks.metadata })
          .from(agentEvalBenchmarks)
          .where(
            and(eq(agentEvalBenchmarks.identifier, view.id), isNull(agentEvalBenchmarks.userId)),
          )
          .limit(1);
        const viewBenchmarkValues = {
          description: view.description,
          isSystem: true,
          metadata: {
            ...((existingViewBenchmark?.metadata ?? {}) as Record<string, unknown>),
            kind: 'lobe-bench',
            view: viewMeta,
          },
          name: view.name,
        };
        let viewBenchmarkId: string;
        if (existingViewBenchmark) {
          viewBenchmarkId = existingViewBenchmark.id;
          await tx
            .update(agentEvalBenchmarks)
            .set({ ...viewBenchmarkValues, updatedAt: new Date() })
            .where(eq(agentEvalBenchmarks.id, viewBenchmarkId));
        } else {
          const [created] = await tx
            .insert(agentEvalBenchmarks)
            .values({ ...viewBenchmarkValues, identifier: view.id, rubrics: [], userId: null })
            .returning({ id: agentEvalBenchmarks.id });
          viewBenchmarkId = created.id;
        }
        // The dataset is named for what it holds; the benchmark carries the brand
        // ("Lobe Bench Hard 50" is made of "Hard 50").
        const viewValues = {
          benchmarkId: viewBenchmarkId,
          description: `${view.caseIds.length} cases of the case library, fixed in this dataset (Pack release ${view.version}).`,
          evalConfig: {
            judgePrompt: 'Grade the attempt against the rules of the case.',
            ...judge,
          },
          evalMode: 'rule-checklist' as const,
          metadata: {
            kind: 'lobe-bench',
            mock: datasetMetadata.mock,
            ...(presentation && { presentation }),
            release: view.version,
            view: viewMeta,
          },
          name: view.name.replace(/^Lobe Bench\s+/, ''),
        };
        // Found wherever it sits: one seeded before its benchmark existed moves under it
        // and keeps its id, so experiments that name it still do.
        const [existingView] = await tx
          .select({ id: agentEvalDatasets.id })
          .from(agentEvalDatasets)
          .where(and(eq(agentEvalDatasets.identifier, view.id), isNull(agentEvalDatasets.userId)))
          .limit(1);
        let viewDatasetId: string;
        if (existingView) {
          viewDatasetId = existingView.id;
          await tx
            .update(agentEvalDatasets)
            .set({ ...viewValues, updatedAt: new Date() })
            .where(eq(agentEvalDatasets.id, viewDatasetId));
        } else {
          const [createdView] = await tx
            .insert(agentEvalDatasets)
            .values({ ...viewValues, identifier: view.id, userId: null })
            .returning({ id: agentEvalDatasets.id });
          viewDatasetId = createdView.id;
        }
        // Its cases: copies of the library rows, updated in place by case id so runs on
        // them keep their results.
        const existingViewCases = await tx
          .select({ id: agentEvalTestCases.id, metadata: agentEvalTestCases.metadata })
          .from(agentEvalTestCases)
          .where(
            and(eq(agentEvalTestCases.datasetId, viewDatasetId), isNull(agentEvalTestCases.userId)),
          );
        const viewByCaseId = new Map(
          existingViewCases.map(
            (c) => [(c.metadata as { caseId?: string } | null)?.caseId, c.id] as const,
          ),
        );
        let copied = 0;
        for (const caseId of view.caseIds) {
          const values = caseRows.get(caseId);
          if (!values) throw new Error(`${view.id}: case ${caseId} is not in ${set.identifier}`);
          const existingId = viewByCaseId.get(caseId);
          if (existingId) {
            await tx
              .update(agentEvalTestCases)
              .set({ ...values, updatedAt: new Date() })
              .where(eq(agentEvalTestCases.id, existingId));
          } else {
            await tx
              .insert(agentEvalTestCases)
              .values({ ...values, datasetId: viewDatasetId, userId: null } as never);
            copied += 1;
          }
        }
        const staleView = existingViewCases
          .filter(
            (c) => !view.caseIds.includes((c.metadata as { caseId?: string } | null)?.caseId ?? ''),
          )
          .map((c) => c.id);
        await retireLobeBenchCases(tx, staleView);
        console.log(
          `${view.id}: benchmark ${viewBenchmarkId} (${existingViewBenchmark ? 'updated' : 'created'}), dataset "${viewValues.name}" ${viewDatasetId} (${existingView ? 'updated' : 'created'}): ${view.caseIds.length} cases (${copied} copied, ${staleView.length} retired; history preserved), release ${view.version}`,
        );
      }
    }

    // 5. Built-in case sets that are no longer shipped, named explicitly: deleting one
    // deletes its cases, runs and results with it (foreign keys cascade), then the
    // Lobe Bench experiments that ran only that set and are left without runs.
    for (const identifier of RETIRE_SETS) {
      if (SETS.some((set) => set.identifier === identifier)) {
        throw new Error(`--retire-set=${identifier} is also seeded by --set`);
      }
      const retired = await tx
        .delete(agentEvalDatasets)
        .where(
          and(
            eq(agentEvalDatasets.benchmarkId, benchmarkId),
            eq(agentEvalDatasets.identifier, identifier),
            isNull(agentEvalDatasets.userId),
          ),
        )
        .returning({ id: agentEvalDatasets.id });
      const retiredIds = retired.map((row) => row.id);
      const emptied = retiredIds.length
        ? await tx
            .delete(agentEvalExperiments)
            .where(
              and(
                sql`${agentEvalExperiments.metadata}->>'kind' = 'lobe-bench'`,
                inArray(sql`${agentEvalExperiments.metadata}->>'datasetId'`, retiredIds),
                sql`not exists (select 1 from ${agentEvalRuns} where ${agentEvalRuns.experimentId} = ${agentEvalExperiments.id})`,
              ),
            )
            .returning({ id: agentEvalExperiments.id })
        : [];
      console.log(
        retiredIds.length
          ? `${identifier} (${retiredIds.join(', ')}): retired with its cases, runs and results; ${emptied.length} experiments left without runs removed`
          : `${identifier}: no built-in case set with this identifier, nothing retired`,
      );
    }
    console.log(
      `benchmark ${benchmarkId}: system, mock dataset ${SETS[0].mockDataset}, ${Object.keys(connectors).length} connectors (address from EVAL_TOOL_MOCK_BASE_URL at run time)`,
    );
  });
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
