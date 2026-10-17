import {
  isProgrammaticTestCheck,
  normalizeVerifySurface,
  PROGRAMMATIC_TEST_CHECK_HINT,
  verifyEvidenceTypes,
  verifySurfaces,
} from '@lobechat/const/verify';
import { verifyCheckDefinitionSchema } from '@lobechat/types';

import { log } from '../../../utils/logger';
import { EVIDENCE_TYPES, VERIFIER_TYPES } from './options';
import { firstString, objectValue } from './values';

/** The id a plan entry / case will be ingested under, mirroring the readers below. */
const planItemId = (item: Record<string, unknown>, index: number) =>
  String(item.id ?? `case-${index + 1}`);
const caseItemId = (item: Record<string, unknown>, index: number) =>
  String(item.id ?? item.checkItemId ?? `case-${index + 1}`);

/** The outcome of {@link screenProgrammaticTestChecks}. */
export interface ProgrammaticTestScreen {
  /** Check ids to omit from both the frozen plan and the ingested cases. */
  droppedIds: Set<string>;
  /** What was dropped, `id — title`, for one warning the author can act on. */
  droppedLabels: string[];
}

/**
 * Which checks in this report are the repo's own programmatic test / static-
 * analysis gates rather than delivery outcomes a person accepts.
 *
 * Screened once, over the plan AND the cases, so a dropped plan item can never
 * leave its case behind as an orphan "unplanned" row (or the reverse). Both
 * sides are matched on their own text, then unioned by id.
 *
 * Dropping one item rather than failing the ingest is deliberate: the round's
 * real checks are still worth publishing, and a hard error would cost the author
 * the whole publish over an item they only meant as a footnote. (The caller does
 * refuse to publish when the screen empties the round — then there is nothing
 * left for a person to accept.)
 */
export function screenProgrammaticTestChecks(
  result: Record<string, unknown>,
): ProgrammaticTestScreen {
  const droppedIds = new Set<string>();
  const droppedLabels: string[] = [];

  const screen = (entry: unknown, id: string) => {
    const item = objectValue(entry);
    if (!item) return;
    const title = firstString(item.title, item.name, item.case);
    if (
      !isProgrammaticTestCheck(
        title,
        firstString(item.category, item.group),
        firstString(item.method, item.how),
      )
    ) {
      return;
    }
    if (!droppedIds.has(id)) {
      droppedIds.add(id);
      droppedLabels.push(title ? `${id} — ${title}` : id);
    }
  };

  if (Array.isArray(result.plan)) {
    result.plan.forEach((entry, index) =>
      screen(entry, planItemId(objectValue(entry) ?? {}, index)),
    );
  }
  if (Array.isArray(result.cases)) {
    result.cases.forEach((entry, index) =>
      screen(entry, caseItemId(objectValue(entry) ?? {}, index)),
    );
  }

  if (droppedLabels.length > 0) {
    log.warn(
      `dropping ${droppedLabels.length} programmatic-test check(s) from this acceptance round:`,
    );
    for (const label of droppedLabels) log.warn(`  - ${label}`);
    log.warn(`  ${PROGRAMMATIC_TEST_CHECK_HINT}`);
  }

  return { droppedIds, droppedLabels };
}

/** Reject an out-of-vocabulary plan value rather than storing a word nothing reads. */
export function assertPlanEnum<T extends string>(
  value: string,
  allowed: readonly T[],
  field: string,
  itemId: string,
): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;

  log.error(`result.json plan item "${itemId}": "${field}" must be one of: ${allowed.join(', ')}`);
  log.error(`  rejected: ${JSON.stringify(value)}`);
  process.exit(1);
}

/**
 * The checks the run set out to make, as frozen plan items.
 *
 * Two of the fields are a closed vocabulary, not free text, because the pipeline
 * actually acts on them:
 *
 * - `verifier` → {@link VerifyCheckItem.verifierType} (`program | agent | llm`):
 *   how the item is judged. Defaults to `agent`, but a command-asserted check is
 *   `program` and mislabelling it hides what actually produced the verdict.
 * - `requiredEvidence` → `verifierConfig.requiredEvidence`
 *   ({@link RequiredEvidenceSpec}, medium from {@link verifyEvidenceTypes}):
 *   the artifact the item MUST produce. The executor's coverage gate fails an
 *   item whose required medium is missing, so this is enforcement, not a label —
 *   an unknown medium would silently gate on nothing.
 *
 * `method` / `expected` stay prose: they are the author's intent in words, which
 * no enum can carry. Everything else the frozen {@link VerifyCheckItem} needs is
 * filled in here, so an author writes only `{ id, title }` plus what they mean.
 *
 * Returns `undefined` when the report declares no `plan` field. A `plan` that is
 * present but empty returns `[]`, recording an explicitly empty plan in this
 * immutable snapshot.
 *
 * `droppedIds` (from {@link screenProgrammaticTestChecks}) omits the repo's own
 * test/lint gates, which are shipping preconditions rather than acceptance items.
 */
export function planFromResult(result: Record<string, unknown>, droppedIds?: Set<string>) {
  if (!Array.isArray(result.plan)) return undefined;

  const items = result.plan.flatMap((entry: unknown, index: number) => {
    const item = objectValue(entry);
    const title = firstString(item?.title, item?.name);
    // An item with no title names no check — it can't be rendered or paired.
    if (!item || !title) return [];

    const id = planItemId(item, index);
    if (droppedIds?.has(id)) return [];
    const method = firstString(item.method, item.how);
    const expected = firstString(item.expected, item.expectation);

    const verifierRaw = firstString(item.verifier, item.verifierType);
    const verifierType = verifierRaw
      ? assertPlanEnum(verifierRaw, VERIFIER_TYPES, 'verifier', id)
      : ('agent' as const);

    const requiredEvidence = Array.isArray(item.requiredEvidence)
      ? item.requiredEvidence.flatMap((spec: unknown) => {
          // Accept the bare medium (`"screenshot"`) or the full spec object.
          const record = objectValue(spec);
          const raw = typeof spec === 'string' ? spec : firstString(record?.type);
          if (!raw) return [];

          return [
            {
              hint: firstString(record?.hint),
              type: assertPlanEnum(raw, EVIDENCE_TYPES, 'requiredEvidence', id),
            },
          ];
        })
      : [];

    // Per-item surface: the acceptance union groups checks by it. Normalized to
    // the closed set (electron → desktop); an unknown value is dropped loudly
    // rather than stored as a mystery chip.
    const surfaceRaw = firstString(item.surface);
    const surface = surfaceRaw ? normalizeVerifySurface(surfaceRaw) : null;
    if (surfaceRaw && !surface) {
      log.warn(
        `plan item "${id}": surface "${surfaceRaw}" names no product surface (expected ${verifySurfaces.join('/')}) — dropping it`,
      );
    }

    // The acceptance union groups by category and folds superseded ids into
    // the new item's iteration timeline — both authored by the harness.
    const category = firstString(item.category, item.group);
    const supersedes = Array.isArray(item.supersedes)
      ? item.supersedes.filter((value: unknown): value is string => typeof value === 'string')
      : [];

    return [
      {
        ...(category === undefined ? {} : { category }),
        description: firstString(item.description),
        sourceCriterionId: firstString(item.sourceCriterionId),
        definition:
          item.definition === undefined
            ? undefined
            : verifyCheckDefinitionSchema.parse(item.definition),
        id,
        index,
        onFail: 'manual' as const,
        required: typeof item.required === 'boolean' ? item.required : true,
        ...(supersedes.length > 0 ? { supersedes } : {}),
        title,
        verifierConfig: {
          ...(method === undefined ? {} : { method }),
          ...(expected === undefined ? {} : { expected }),
          ...(requiredEvidence.length > 0 ? { requiredEvidence } : {}),
          ...(surface ? { surface } : {}),
        },
        verifierType,
      },
    ];
  });

  // `[]` is meaningful — it clears a stale plan. Only an absent `plan` field
  // (handled above) means "don't touch what's stored".
  return items;
}

interface ExistingAcceptanceCheck {
  id: string;
  planItem?: { id?: string; sourceCriterionId?: string | null } | null;
}

/**
 * Line a new round's plan up with the checks its acceptance already holds.
 * The server mints a fresh criterion for every item that arrives without one,
 * and the union keys rows by criterion — so a re-verification that skips this
 * lands every check as a brand-new row instead of the next entry in its history.
 */
export function reuseSourceCriteria<T extends { id: string; sourceCriterionId?: string | null }>(
  plan: T[] | undefined,
  checks: ExistingAcceptanceCheck[] | null | undefined,
): T[] | undefined {
  if (!plan || !checks?.length) return plan;

  return plan.map((item) => ({
    ...item,
    sourceCriterionId:
      item.sourceCriterionId ??
      checks.find((check) => check.id === item.id || check.planItem?.id === item.id)?.planItem
        ?.sourceCriterionId ??
      undefined,
  }));
}

interface ExistingAcceptanceRound {
  report?: { content?: string | null; summary?: string | null } | null;
  run: {
    id: string;
    plan?: { id: string; title: string }[] | null;
    roundIndex?: number | null;
  };
}

/**
 * The acceptance's latest round when it already publishes exactly this report.
 * Re-running the same ingest (a retry loop, a re-sent command) would otherwise
 * stack identical rounds on the page. Compares what the author wrote — body,
 * conclusion and plan — not the published counts, which the ingest derives
 * later from evidence uploads. Only a report with a body counts: without one,
 * two genuinely different runs of the same plan are indistinguishable here.
 */
export function findIdenticalLatestRound(
  rounds: ExistingAcceptanceRound[] | null | undefined,
  incoming: {
    plan?: { id: string; title: string }[];
    report: { content?: string; summary?: string };
  },
): ExistingAcceptanceRound['run'] | undefined {
  if (!incoming.report.content || !rounds?.length) return undefined;

  const latest = rounds.reduce((a, b) =>
    (b.run.roundIndex ?? 0) > (a.run.roundIndex ?? 0) ? b : a,
  );
  const published = latest.report;
  if (!published) return undefined;

  const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
  const planKey = (items: { id: string; title: string }[] | null | undefined) =>
    JSON.stringify((items ?? []).map(({ id, title }) => [id, title]));

  const identical =
    same(published.content, incoming.report.content) &&
    same(published.summary, incoming.report.summary) &&
    planKey(latest.run.plan) === planKey(incoming.plan);

  return identical ? latest.run : undefined;
}
