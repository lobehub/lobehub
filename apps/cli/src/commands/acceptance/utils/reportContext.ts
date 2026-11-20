import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { VerifyRunOrigin, VerifyRunScenario, VerifySurface } from '@lobechat/const/verify';
import {
  GOMS_KLM_TRACE_FILE,
  normalizeVerifySurface,
  verifyRunScenarios,
  verifySurfaces,
} from '@lobechat/const/verify';
import type { VerifyInteractionCost } from '@lobechat/types';
import { parseKlmTrace, summarizeKlmTrace } from '@lobechat/utils/verify/interactionCost';

import { log } from '../../../utils/logger';
import { firstString, firstStringOrNumber, objectValue, safeWebUrl } from './values';

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

/**
 * Derive the round's GOMS-KLM interaction cost from a trace dropped in the
 * report directory, so the number the page shows is always the platform's own
 * counting of the recorded actions.
 *
 * Interaction cost is an optional overlay. A round with no UI driver — a CLI
 * verification, or a machine without agent-browser — simply has no trace, and
 * that is silently skipped, never a warning and never a failure. A driver that
 * computed its own summary still wins.
 *
 * "Its own summary" means an actual object. A scaffolded `result.json` carries
 * `"interactionCost": null` to document the field, and a null is the absence of
 * a measurement, not an assertion that this round cost nothing — treating mere
 * key presence as an override let the report scaffolder silently suppress
 * pricing on every traced run it created.
 */
export function interactionCostFromReportDir(
  dir: string,
  result: Record<string, unknown>,
): VerifyInteractionCost | undefined {
  if (objectValue(result.interactionCost)) return undefined;

  const tracePath = path.join(dir, GOMS_KLM_TRACE_FILE);
  if (!existsSync(tracePath)) return undefined;

  let raw: string;
  try {
    raw = readFileSync(tracePath, 'utf8');
  } catch {
    log.warn(`${GOMS_KLM_TRACE_FILE} could not be read — publishing without interaction cost`);
    return undefined;
  }

  const cost = summarizeKlmTrace(parseKlmTrace(raw), { sourceTrace: GOMS_KLM_TRACE_FILE });
  if (!cost) {
    log.warn(
      `${GOMS_KLM_TRACE_FILE} recorded no priceable action (driver missing, or every action blocked) — skipping interaction cost`,
    );
    return undefined;
  }

  return cost;
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
