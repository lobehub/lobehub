import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type {
  AcceptanceSubjectType,
  VerifyRunOrigin,
  VerifyRunScenario,
  VerifySurface,
} from '@lobechat/const/verify';
import {
  acceptanceSubjectTypes,
  isProgrammaticTestCheck,
  normalizeVerifySurface,
  PROGRAMMATIC_TEST_CHECK_HINT,
  verifyEvidenceTypes,
  verifyRunScenarios,
  verifySurfaces,
} from '@lobechat/const/verify';
import type {
  VerifyCheckResultMetadata,
  VerifyVisualizationDataset,
  VerifyVisualizationField,
  VerifyVisualizationManifest,
  VerifyVisualizationValue,
  VerifyVisualizationView,
} from '@lobechat/types';
import pc from 'picocolors';

import { printTable, truncate } from '../utils/format';
import { log } from '../utils/logger';

export type VerifierType = 'agent' | 'llm' | 'program';
export type OnFail = 'auto_repair' | 'manual';
export type Decision = 'accepted' | 'overridden' | 'rejected';

export const VERIFIER_TYPES: VerifierType[] = ['program', 'agent', 'llm'];
export const ON_FAIL: OnFail[] = ['manual', 'auto_repair'];
export const DECISIONS: Decision[] = ['accepted', 'rejected', 'overridden'];
/** The evidence media a plan item may require — the same closed set the executor gates on. */
export const EVIDENCE_TYPES = verifyEvidenceTypes;

export function parseConfig(raw?: string): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    log.error('--config must be valid JSON');
    process.exit(1);
  }
}

export function assertEnum<T extends string>(
  value: T | undefined,
  allowed: T[],
  flag: string,
): void {
  if (value !== undefined && !allowed.includes(value)) {
    log.error(`${flag} must be one of: ${allowed.join(', ')}`);
    process.exit(1);
  }
}

export type Verdict = 'failed' | 'passed' | 'uncertain';
export type EvidenceType =
  'audio' | 'dom_snapshot' | 'gif' | 'markdown' | 'screenshot' | 'text' | 'transcript' | 'video';

export const INLINE_TEXT_EVIDENCE_LIMIT = 5000;
export const INLINE_TEXT_EVIDENCE_TYPES = new Set<EvidenceType>([
  'dom_snapshot',
  'markdown',
  'text',
  'transcript',
]);

/** Map a free-form case/summary result token onto the verify verdict vocabulary. */
export function toVerdict(raw: unknown): Verdict {
  const s = String(raw ?? '').toLowerCase();
  if (['pass', 'passed', 'ok', 'success'].includes(s)) return 'passed';
  if (['fail', 'failed', 'error'].includes(s)) return 'failed';
  return 'uncertain'; // partial / blocked / skipped / pending / unknown
}

/**
 * The report's headline verdict when the author didn't set `summary.verdict`:
 * derived from the ingested cases, so a report can never ship verdict-less and
 * render as a permanent "?" in every list surface.
 */
export function deriveReportVerdict(cases: unknown[]): Verdict | undefined {
  // Same field fallback as the per-case ingest (`result ?? status ?? verdict`) —
  // the documented case field is `status`, so dropping it here derived
  // `uncertain` for an all-pass report whenever this fallback actually ran.
  const verdicts = cases.map((c) =>
    toVerdict((c as any)?.result ?? (c as any)?.status ?? (c as any)?.verdict),
  );
  if (verdicts.length === 0) return undefined;
  if (verdicts.includes('failed')) return 'failed';
  if (verdicts.includes('uncertain')) return 'uncertain';
  return 'passed';
}

/** Pick an evidence medium from a file extension. */
export function evidenceTypeForFile(file: string): EvidenceType {
  const ext = path.extname(file).toLowerCase().slice(1);
  if (ext === 'gif') return 'gif';
  if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'bmp'].includes(ext)) return 'screenshot';
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return 'video';
  // Audio before the text fallback: an unrecognized binary used to land on
  // `text`, publishing a TTS clip as an unreadable, unplayable blob.
  if (
    ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'aiff', 'aif', 'wma'].includes(ext)
  )
    return 'audio';
  if (['html', 'htm'].includes(ext)) return 'dom_snapshot';
  if (['md', 'markdown'].includes(ext)) return 'markdown';
  return 'text';
}

export function inlineTextEvidenceForFile(
  file: string,
  type: EvidenceType | string,
): string | undefined {
  if (!INLINE_TEXT_EVIDENCE_TYPES.has(type as EvidenceType)) return undefined;

  try {
    const buffer = readFileSync(file);
    if (buffer.includes(0)) return undefined;

    const content = buffer.toString('utf8');
    return content.length > 0 && content.length < INLINE_TEXT_EVIDENCE_LIMIT ? content : undefined;
  } catch {
    return undefined;
  }
}

/** Normalize a case's `evidence` field (string | string[] | {path}[]) to path strings. */
export interface ReportEvidenceInput {
  comparison?: {
    id: string;
    label?: string;
    layout?: 'horizontal' | 'vertical';
    role: 'after' | 'before';
  };
  description?: string;
  path: string;
}

const VISUALIZATION_FIELD_TYPES = new Set(['boolean', 'category', 'number', 'string', 'temporal']);
const VISUALIZATION_TYPES = new Set([
  'bar-chart',
  'heatmap',
  'line-chart',
  'metric-comparison',
  'scatter-plot',
  'table',
]);
const MAX_INLINE_VISUALIZATION_ROWS = 10_000;

const visualizationValue = (value: unknown): value is VerifyVisualizationValue =>
  value === null || ['boolean', 'number', 'string'].includes(typeof value);

const visualizationField = (
  encoding: Record<string, unknown>,
  key: string,
  fieldKeys: Set<string>,
  path: string,
) => {
  const field = firstString(encoding[key]);
  if (!field || !fieldKeys.has(field)) {
    throw new Error(`${path}.${key} must reference a declared dataset field`);
  }
  return field;
};

const optionalVisualizationField = (
  encoding: Record<string, unknown>,
  key: string,
  fieldKeys: Set<string>,
  path: string,
) => {
  if (encoding[key] === undefined) return;
  visualizationField(encoding, key, fieldKeys, path);
};

const optionalVisualizationString = (value: Record<string, unknown>, key: string, path: string) => {
  if (value[key] !== undefined && !firstString(value[key])) {
    throw new Error(`${path}.${key} must be a non-empty string`);
  }
};

const visualizationSeries = (
  encoding: Record<string, unknown>,
  fieldKeys: Set<string>,
  path: string,
  options?: { styles?: boolean },
) => {
  if (!Array.isArray(encoding.series) || encoding.series.length === 0) {
    throw new Error(`${path}.series must be a non-empty array`);
  }
  encoding.series.forEach((rawSeries, seriesIndex) => {
    const series = objectValue(rawSeries);
    const seriesPath = `${path}.series[${seriesIndex}]`;
    if (!series) throw new Error(`${seriesPath} must be an object`);
    visualizationField(series, 'field', fieldKeys, seriesPath);
    if (series.label !== undefined && !firstString(series.label)) {
      throw new Error(`${seriesPath}.label must be a non-empty string`);
    }
    if (
      options?.styles &&
      series.style !== undefined &&
      !['accent', 'muted', 'primary'].includes(String(series.style))
    ) {
      throw new Error(`${seriesPath}.style is invalid`);
    }
  });
};

const validateVisualizationEncoding = (
  view: Record<string, unknown>,
  fieldKeys: Set<string>,
  index: number,
) => {
  const path = `visualizations[${index}].encoding`;
  if (view.type === 'table' && view.encoding === undefined) return;
  const encoding = objectValue(view.encoding);
  if (!encoding) throw new Error(`${path} is required for ${String(view.type)}`);

  switch (view.type) {
    case 'bar-chart': {
      visualizationField(encoding, 'category', fieldKeys, path);
      visualizationSeries(encoding, fieldKeys, path);
      optionalVisualizationString(encoding, 'valueLabel', path);
      break;
    }
    case 'heatmap': {
      visualizationField(encoding, 'x', fieldKeys, path);
      visualizationField(encoding, 'y', fieldKeys, path);
      visualizationField(encoding, 'value', fieldKeys, path);
      break;
    }
    case 'line-chart': {
      visualizationField(encoding, 'x', fieldKeys, path);
      visualizationSeries(encoding, fieldKeys, path, { styles: true });
      optionalVisualizationString(encoding, 'xLabel', path);
      optionalVisualizationString(encoding, 'yLabel', path);
      break;
    }
    case 'metric-comparison': {
      visualizationField(encoding, 'label', fieldKeys, path);
      visualizationField(encoding, 'before', fieldKeys, path);
      visualizationField(encoding, 'after', fieldKeys, path);
      for (const key of [
        'afterSamples',
        'beforeSamples',
        'direction',
        'statistic',
        'target',
        'unit',
      ]) {
        optionalVisualizationField(encoding, key, fieldKeys, path);
      }
      break;
    }
    case 'scatter-plot': {
      visualizationField(encoding, 'x', fieldKeys, path);
      visualizationField(encoding, 'y', fieldKeys, path);
      optionalVisualizationField(encoding, 'color', fieldKeys, path);
      optionalVisualizationField(encoding, 'label', fieldKeys, path);
      optionalVisualizationString(encoding, 'xLabel', path);
      optionalVisualizationString(encoding, 'yLabel', path);
      break;
    }
    case 'table': {
      if (encoding.columns !== undefined) {
        if (!Array.isArray(encoding.columns) || encoding.columns.length === 0) {
          throw new Error(`${path}.columns must be a non-empty array`);
        }
        encoding.columns.forEach((field, fieldIndex) =>
          visualizationField({ field }, 'field', fieldKeys, `${path}.columns[${fieldIndex}]`),
        );
      }
      if (encoding.highlights !== undefined) {
        if (!Array.isArray(encoding.highlights)) {
          throw new Error(`${path}.highlights must be an array`);
        }
        encoding.highlights.forEach((rawHighlight, highlightIndex) => {
          const highlight = objectValue(rawHighlight);
          const highlightPath = `${path}.highlights[${highlightIndex}]`;
          if (!highlight) throw new Error(`${highlightPath} must be an object`);
          visualizationField(highlight, 'field', fieldKeys, highlightPath);
          if (highlight.mode !== 'max' && highlight.mode !== 'min') {
            throw new Error(`${highlightPath}.mode must be max or min`);
          }
        });
      }
      break;
    }
  }
};

/** Parse the case's datasets + views into versioned check-result metadata. */
export function visualizationMetadata(value: unknown): VerifyCheckResultMetadata | undefined {
  const input = objectValue(value);
  if (!input || (input.datasets === undefined && input.visualizations === undefined))
    return undefined;
  if (!Array.isArray(input.datasets) || !Array.isArray(input.visualizations)) {
    throw new Error('datasets and visualizations must both be arrays');
  }

  let rowCount = 0;
  const datasets = input.datasets.map((rawDataset, datasetIndex) => {
    const dataset = objectValue(rawDataset);
    const id = firstString(dataset?.id);
    if (!id || !Array.isArray(dataset?.fields) || !Array.isArray(dataset.rows)) {
      throw new Error(`datasets[${datasetIndex}] needs id, fields, and rows`);
    }

    const fields = dataset.fields.map((rawField, fieldIndex) => {
      const field = objectValue(rawField);
      const key = firstString(field?.key);
      const type = field?.type;
      if (!key || typeof type !== 'string' || !VISUALIZATION_FIELD_TYPES.has(type)) {
        throw new Error(`datasets[${datasetIndex}].fields[${fieldIndex}] is invalid`);
      }
      return {
        key,
        label: firstString(field.label),
        type,
        unit: firstString(field.unit),
      } as VerifyVisualizationField;
    });
    const fieldKeys = new Set(fields.map((field) => field.key));
    if (fieldKeys.size !== fields.length) {
      throw new Error(`datasets[${datasetIndex}] field keys must be unique`);
    }

    const rows = dataset.rows.map((rawRow, rowIndex) => {
      const row = objectValue(rawRow);
      if (
        !row ||
        Object.entries(row).some(([key, cell]) => !fieldKeys.has(key) || !visualizationValue(cell))
      ) {
        throw new Error(`datasets[${datasetIndex}].rows[${rowIndex}] does not match its fields`);
      }
      return row as Record<string, VerifyVisualizationValue>;
    });
    rowCount += rows.length;
    return { fields, id, rows } satisfies VerifyVisualizationDataset;
  });

  if (rowCount > MAX_INLINE_VISUALIZATION_ROWS) {
    throw new Error(`visualization metadata exceeds ${MAX_INLINE_VISUALIZATION_ROWS} inline rows`);
  }
  const datasetIds = new Set(datasets.map((dataset) => dataset.id));
  if (datasetIds.size !== datasets.length) throw new Error('dataset ids must be unique');
  const fieldKeysByDataset = new Map(
    datasets.map((dataset) => [dataset.id, new Set(dataset.fields.map((field) => field.key))]),
  );

  const views = input.visualizations.map((rawView, index) => {
    const view = objectValue(rawView);
    const id = firstString(view?.id);
    const type = view?.type;
    const dataset = firstString(view?.dataset);
    if (
      !id ||
      typeof type !== 'string' ||
      !VISUALIZATION_TYPES.has(type) ||
      !dataset ||
      !datasetIds.has(dataset) ||
      view.version !== 1
    ) {
      throw new Error(`visualizations[${index}] has an invalid id, type, version, or dataset`);
    }
    optionalVisualizationString(view, 'context', `visualizations[${index}]`);
    optionalVisualizationString(view, 'title', `visualizations[${index}]`);
    validateVisualizationEncoding(view, fieldKeysByDataset.get(dataset)!, index);
    return view as unknown as VerifyVisualizationView;
  });
  if (new Set(views.map((view) => view.id)).size !== views.length) {
    throw new Error('visualization ids must be unique');
  }

  const visualization: VerifyVisualizationManifest = { datasets, schemaVersion: 1, views };
  return { visualization };
}

export function reportEvidence(evidence: unknown): ReportEvidenceInput[] {
  if (!evidence) return [];
  const arr = Array.isArray(evidence) ? evidence : [evidence];
  return arr
    .map((e): ReportEvidenceInput | null => {
      if (typeof e === 'string') return { path: e };
      const value = objectValue(e);
      const evidencePath = value && firstString(value.path, value.file);
      if (!evidencePath) return null;
      const comparison = objectValue(value.comparison);
      const role = comparison?.role;
      const id = firstString(comparison?.id);
      // The report viewer pairs on `id` and drops any comparison lacking one, so
      // an id-less half could never render side by side. Warn rather than upload
      // a comparison that is silently downgraded to an ordinary image.
      //
      // Test the raw field, not the parsed object: a comparison written flat
      // (`comparison: "row", role: "before"`) is not an object at all, so keying
      // the warning off `objectValue()` skipped the one shape that most needs
      // it — the author saw a clean ingest and unpaired images on the page.
      // Absent means null/undefined only; `""` / `0` / `false` are malformed
      // values that were written on purpose, so they warn like any other.
      const hasComparison = value.comparison !== undefined && value.comparison !== null;
      if (hasComparison && !(comparison && id && (role === 'before' || role === 'after'))) {
        log.warn(
          `evidence ${evidencePath}: comparison must be an object with a string "id" and role "before"/"after" — ignoring it`,
        );
      }
      const layout = comparison?.layout === 'vertical' ? 'vertical' : undefined;
      return {
        comparison:
          id && (role === 'before' || role === 'after')
            ? { id, label: firstString(comparison?.label), layout, role }
            : undefined,
        description: firstString(value.description, value.desc),
        path: evidencePath,
      };
    })
    .filter((item): item is ReportEvidenceInput => item !== null);
}

export function firstString(...values: unknown[]): string | undefined {
  return values.find((v): v is string => typeof v === 'string' && v.length > 0);
}

export function firstStringOrNumber(...values: unknown[]): string | number | undefined {
  return values.find(
    (v): v is string | number => (typeof v === 'string' && v.length > 0) || typeof v === 'number',
  );
}

export function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function safeWebUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Normalize common agent-testing PR shapes into the verify coding scope. */
export function pullRequestFromResult(result: Record<string, unknown>) {
  const pr = objectValue(result.pullRequest) ?? objectValue(result.pr);
  const url = safeWebUrl(
    firstString(
      pr?.url,
      pr?.htmlUrl,
      pr?.html_url,
      result.pullRequestUrl,
      result.prUrl,
      typeof result.pr === 'string' ? result.pr : undefined,
    ),
  );
  const number = firstStringOrNumber(pr?.number, result.pullRequestNumber, result.prNumber);
  const title = firstString(pr?.title, result.pullRequestTitle, result.prTitle);
  const entries = Object.entries({ number, title, url }).filter(([, v]) => v !== undefined);

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * The PR for a branch, asked of `gh`. A report almost always verifies a branch
 * that already has one, but the author has to remember to write it down — and
 * mostly doesn't, so the report loses its single most useful outbound link.
 * Best-effort by design: no `gh`, not a repo, not authenticated, or no PR for
 * the branch all mean "no PR", never a failed publish.
 */
export function pullRequestFromBranch(branch: string | undefined) {
  if (!branch) return undefined;

  try {
    const raw = execFileSync(
      'gh',
      ['pr', 'view', branch, '--json', 'number,title,url'],
      // `gh` writes its "no pull requests found" diagnostics to stderr; keep them
      // off the CLI's own output.
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 },
    );
    const parsed = objectValue(JSON.parse(raw));
    const url = safeWebUrl(firstString(parsed?.url));
    const number = firstStringOrNumber(parsed?.number);
    const title = firstString(parsed?.title);
    const entries = Object.entries({ number, title, url }).filter(([, v]) => v !== undefined);

    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The surfaces the report says it exercised, as canonical values.
 *
 * Strict on purpose: an unrecognized surface is a hard error, not a silently
 * dropped value. Free-form surfaces are how the field rotted — prose, runtime
 * modes ("packaged build") and test kinds ("unit", "type-check") all ended up in
 * it, and none of them render. Failing here puts the fix in the author's hands
 * while they still have the context to make it.
 */
export function surfacesFromResult(result: Record<string, unknown>): VerifySurface[] | undefined {
  if (!Array.isArray(result.surfaces)) return undefined;

  const raw = result.surfaces.filter((s: unknown): s is string => typeof s === 'string');
  const canonical: VerifySurface[] = [];
  const rejected: string[] = [];

  for (const value of raw) {
    const surface = normalizeVerifySurface(value);
    if (surface) {
      if (!canonical.includes(surface)) canonical.push(surface);
    } else {
      rejected.push(value);
    }
  }

  if (rejected.length > 0) {
    log.error(
      `result.json "surfaces" must name the product surface a check ran on, one of: ${verifySurfaces.join(', ')}`,
    );
    log.error(`  rejected: ${rejected.map((v) => JSON.stringify(v)).join(', ')}`);
    log.error(
      '  Runtime detail ("packaged build", "CDP dev instance") belongs on a plan item\'s "method"; a test kind ("unit", "backend") is not a surface — a backend change verified through the CLI has surface "cli".',
    );
    process.exit(1);
  }

  return canonical.length > 0 ? canonical : undefined;
}

/**
 * What kind of delivery the report verified. Defaults to `coding` — the
 * agent-testing harness's home turf — and rejects an unknown value rather than
 * storing a scenario nothing renders (mirrors the strict surface policy: the
 * author still has the context to fix it).
 */
export function scenarioFromResult(result: Record<string, unknown>): VerifyRunScenario {
  const raw = result.scenario;
  if (raw === undefined) return 'coding';
  if (typeof raw === 'string' && (verifyRunScenarios as readonly string[]).includes(raw)) {
    return raw as VerifyRunScenario;
  }

  log.error(
    `result.json "scenario" must be one of: ${verifyRunScenarios.join(', ')} — rejected: ${JSON.stringify(raw)}`,
  );
  process.exit(1);
}

/**
 * A non-coding scenario's scope, passed through from result.json `context` as
 * the scenario's own bag (the server stores it as-is; known shapes live in
 * `@lobechat/types`). Top-level `entry` / `createdAt` are lifted as defaults so
 * every scenario gets the shared provenance fields for free; explicit `context`
 * keys win.
 */
export function genericContextFromResult(
  result: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const bag = objectValue(result.context) ?? {};
  const entries = Object.entries({
    entry: firstString(result.entry),
    testedAt: firstString(result.createdAt),
    ...bag,
  }).filter(([, v]) => v !== undefined);

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

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

/**
 * The LobeHub conversation this harness is running inside, read off the env the
 * agent runtime echoes into the child process. Lets a report published from an
 * in-app agent link back to the session that produced it with no flags to
 * remember. Absent (a plain terminal) → no origin, which is not an error.
 *
 * Reads the env and ONLY the env. `--operation` is the opposite relation — the
 * Agent Run this session *verifies* — so letting it fall through to here would
 * attribute the report to the run under test instead of the run that wrote it,
 * corrupting the very provenance this records. The two ids are independent and
 * may legitimately differ in the same publish.
 */
export function originFromEnv(): VerifyRunOrigin | undefined {
  const origin: VerifyRunOrigin = {
    agentId: firstString(process.env.LOBEHUB_AGENT_ID),
    operationId: firstString(process.env.LOBEHUB_OPERATION_ID),
    topicId: firstString(process.env.LOBEHUB_TOPIC_ID),
  };

  return Object.values(origin).some(Boolean) ? origin : undefined;
}

export function metadataForReport(
  result: Record<string, unknown>,
  existingMetadata?: unknown,
  origin?: VerifyRunOrigin,
): Record<string, unknown> | undefined {
  const hasInteractionCost = Object.prototype.hasOwnProperty.call(result, 'interactionCost');
  // Nothing to write is not the same as writing an empty metadata bag.
  if (!hasInteractionCost && !origin) return undefined;

  const metadata = { ...objectValue(existingMetadata) };

  if (hasInteractionCost) {
    const interactionCost = objectValue(result.interactionCost);

    if (interactionCost) {
      metadata.interactionCost = interactionCost;
    } else {
      delete metadata.interactionCost;
    }
  }

  if (origin) metadata.origin = origin;

  return metadata;
}

/** A parsed acceptance subject reference (`task:<id>` / `topic:<id>` / `document:<id>`). */
export interface AcceptanceSubjectRef {
  subjectId: string;
  subjectType: AcceptanceSubjectType;
}

/**
 * Parse a `type:id` subject reference. Returns null on anything malformed —
 * callers decide whether that is an error (an explicit `--subject`) or a
 * silently absent field (result.json).
 */
export function parseSubjectRef(raw: unknown): AcceptanceSubjectRef | null {
  if (typeof raw !== 'string') return null;
  const idx = raw.indexOf(':');
  if (idx <= 0) return null;
  const type = raw.slice(0, idx).trim().toLowerCase();
  const id = raw.slice(idx + 1).trim();
  if (!id || !(acceptanceSubjectTypes as readonly string[]).includes(type)) return null;
  return { subjectId: id, subjectType: type as AcceptanceSubjectType };
}

/**
 * The acceptance subject a report attributes itself to, from result.json's
 * `subject` field — either `"task:<id>"` or `{ type, id, requirement? }`. An
 * explicit `--subject` flag wins over this.
 */
export function subjectFromResult(result: Record<string, unknown>): {
  ref: AcceptanceSubjectRef;
  requirement?: string;
} | null {
  const raw = result.subject;
  if (typeof raw === 'string') {
    const ref = parseSubjectRef(raw);
    return ref ? { ref } : null;
  }
  const value = objectValue(raw);
  if (!value) return null;
  const ref = parseSubjectRef(`${firstString(value.type) ?? ''}:${firstString(value.id) ?? ''}`);
  return ref ? { ref, requirement: firstString(value.requirement) } : null;
}

/** Default acceptance subject for a report authored inside a LobeHub topic. */
export function subjectFromEnv(): AcceptanceSubjectRef | null {
  const topicId = firstString(process.env.LOBEHUB_TOPIC_ID);
  return topicId ? { subjectId: topicId, subjectType: 'topic' } : null;
}

export function printResults(results: any[]): void {
  printTable(
    results.map((r) => [
      truncate(r.checkItemTitle || r.checkItemId, 50),
      statusColor(r.status),
      r.verdict ?? '',
      r.confidence != null ? String(r.confidence) : '',
      r.required ? 'gate' : 'soft',
      truncate(r.suggestion || '', 40),
    ]),
    ['CHECK', 'STATUS', 'VERDICT', 'CONF', 'BLOCK', 'SUGGESTION'],
  );
}

export function statusColor(status: string): string {
  if (status === 'passed') return pc.green(status);
  if (status === 'failed') return pc.red(status);
  if (status === 'running') return pc.yellow(status);
  return pc.dim(status);
}

/** A region a reviewer circled on one evidence image. */
export interface ReviewAnnotationRegion {
  comment?: string;
  evidenceId?: string;
  rect?: { height?: number; width?: number; x?: number; y?: number };
}

const asPercent = (value?: number) =>
  typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : undefined;

/**
 * Where a review annotation points, rendered for a terminal.
 *
 * The comment alone is not enough to act on: a screenshot usually has several
 * plausible targets, and without the image and the rect the reader has to guess
 * which one was circled. `rect` is normalized to the image box (0–1), so it is
 * printed as percentages.
 *
 * Returns `undefined` when the annotation carries no location at all — an older
 * review, or one made before regions existed.
 */
export function formatAnnotationRegion(
  annotation: ReviewAnnotationRegion,
  evidenceLabels?: Map<string, string>,
): string | undefined {
  const label = annotation.evidenceId
    ? (evidenceLabels?.get(annotation.evidenceId) ?? annotation.evidenceId)
    : undefined;

  const { rect } = annotation;
  const x = asPercent(rect?.x);
  const y = asPercent(rect?.y);
  const width = asPercent(rect?.width);
  const height = asPercent(rect?.height);
  const at = x && y ? `${x},${y}` : undefined;
  const size = width && height ? `${width}×${height}` : undefined;
  const position = [at, size].filter(Boolean).join(' · ');

  if (!label && !position) return undefined;
  if (!position) return label;
  return label ? `${label} @ ${position}` : position;
}
