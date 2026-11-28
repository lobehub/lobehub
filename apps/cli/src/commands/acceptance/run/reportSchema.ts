import { constants } from 'node:fs';
import { access, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { verifyEvidenceTypes, verifyRunScenarios, verifySurfaces } from '@lobechat/const/verify';
import { verifyCheckDefinitionSchema } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';
import { type CoverageEvidence, coverageGaps } from '@lobechat/utils/verify/evidenceCoverage';
import { z } from 'zod';

import { loadTerminalBundle, terminalBundleDir } from '../../../utils/terminalEvidence/bundle';
import { evidenceTypeForFile, reportEvidence, visualizationMetadata } from '../utils';

const evidenceDescriptorFields = {
  description: z.string().min(1),
};

const evidenceSchema = z
  .object({
    ...evidenceDescriptorFields,
    type: z.enum(verifyEvidenceTypes).optional(),
    path: z.string().min(1),
    content: z.never().optional(),
  })
  .passthrough();

const requiredEvidenceSchema = z.union([
  z.enum(verifyEvidenceTypes),
  z
    .object({
      type: z.enum(verifyEvidenceTypes),
      hint: z.string().optional(),
      provenance: z.literal('execution').optional(),
    })
    .passthrough(),
]);

const planItemSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    method: z.string().min(1),
    expected: z.string().min(1),
    surface: z.enum(verifySurfaces).optional(),
    requiredEvidence: z.array(requiredEvidenceSchema),
    definition: verifyCheckDefinitionSchema.optional(),
  })
  .passthrough();

const caseSchema = z
  .object({
    id: z.string().min(1),
    surface: z.enum(verifySurfaces),
    status: z.enum(['pass', 'fail', 'blocked', 'passed', 'failed']),
    observation: z.string().min(1),
    evidence: z.array(evidenceSchema),
  })
  .passthrough();

/** Canonical authoring shape. Local relations and file checks live in validateAcceptanceReport. */
export const acceptanceReportSchema = z
  .object({
    title: z.string().trim().min(1),
    scenario: z.enum(verifyRunScenarios).optional(),
    surface: z.enum(verifySurfaces).optional(),
    plan: z.array(planItemSchema),
    cases: z.array(caseSchema),
  })
  .passthrough();

export type AcceptanceReport = z.infer<typeof acceptanceReportSchema>;

export function createAcceptanceReportTemplate(surface: (typeof verifySurfaces)[number]) {
  return {
    title: 'Acceptance report draft',
    scenario: 'coding' as const,
    surface,
    plan: [
      {
        id: 'replace-with-check-id',
        title: 'Describe the outcome to verify',
        method: 'Describe how this check will be performed',
        expected: 'Describe the expected behavior',
        surface,
        requiredEvidence: [],
      },
    ],
    cases: [],
  };
}

export function getAcceptanceReportJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(acceptanceReportSchema) as Record<string, unknown>;
}

export interface AcceptanceReportValidation {
  cases: number;
  draft: boolean;
  errors: { path: string; message: string }[];
  planItems: number;
  valid: boolean;
  warnings: { path: string; message: string }[];
}

/** Validate a local result.json without credentials, network access, or writes. */
export async function validateAcceptanceReport(
  reportDir: string,
): Promise<AcceptanceReportValidation> {
  const errors: AcceptanceReportValidation['errors'] = [];
  const warnings: AcceptanceReportValidation['warnings'] = [
    {
      path: '',
      message: 'Media inspection, account language, and remote plan membership are unchecked.',
    },
  ];
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path.join(reportDir, 'result.json'), 'utf8'));
  } catch (error) {
    return {
      valid: false,
      draft: true,
      errors: [
        { path: 'result.json', message: error instanceof Error ? error.message : String(error) },
      ],
      warnings,
      planItems: 0,
      cases: 0,
    };
  }

  const parsed = acceptanceReportSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({
        path: issue.path
          .map((part) => (typeof part === 'number' ? `[${part}]` : part))
          .join('.')
          .replaceAll('.[', '['),
        message: issue.message,
      });
    }
    const rawObject = isRecord(raw) ? raw : undefined;
    return {
      valid: false,
      draft: true,
      errors,
      warnings,
      planItems: Array.isArray(rawObject?.plan) ? rawObject.plan.length : 0,
      cases: Array.isArray(rawObject?.cases) ? rawObject.cases.length : 0,
    };
  }

  const report = parsed.data;
  const realReportDir = await realpath(reportDir);
  const planIds = new Set<string>();
  for (const [index, item] of report.plan.entries()) {
    if (planIds.has(item.id)) {
      errors.push({ path: `plan[${index}].id`, message: `Duplicate plan id "${item.id}".` });
    }
    planIds.add(item.id);
  }
  const caseIds = new Set<string>();
  for (const [index, item] of report.cases.entries()) {
    if (caseIds.has(item.id)) {
      errors.push({ path: `cases[${index}].id`, message: `Duplicate case id "${item.id}".` });
    }
    caseIds.add(item.id);
    if (!planIds.has(item.id)) {
      errors.push({
        path: `cases[${index}].id`,
        message: `Case id "${item.id}" is not present in plan.`,
      });
    }

    try {
      visualizationMetadata(item);
    } catch (error) {
      errors.push({
        path: `cases[${index}]`,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    /** What this case would publish, for the required-evidence check below. */
    const caseCoverage: CoverageEvidence[] = [];
    for (const [evidenceIndex, evidence] of item.evidence.entries()) {
      const absoluteReportDir = path.resolve(reportDir);
      const absoluteEvidencePath = path.resolve(absoluteReportDir, evidence.path);
      // A terminal evidence bundle is a directory (or its terminal.json); ingest
      // publishes it as one `terminal` row carrying the bundle's record.
      const bundleDir = terminalBundleDir(absoluteEvidencePath);
      const inferredType = bundleDir ? 'terminal' : evidenceTypeForFile(evidence.path);
      if (evidence.type && evidence.type !== inferredType) {
        errors.push({
          path: `cases[${index}].evidence[${evidenceIndex}].type`,
          message: `Evidence type "${evidence.type}" conflicts with filename inference ("${inferredType}"). Ingest infers the type from the file suffix.`,
        });
      }
      if (bundleDir) {
        const relativeBundle = path.relative(absoluteReportDir, bundleDir);
        if (
          path.isAbsolute(evidence.path) ||
          relativeBundle === '..' ||
          relativeBundle.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relativeBundle)
        ) {
          errors.push({
            path: `cases[${index}].evidence[${evidenceIndex}].path`,
            message: 'Evidence path must stay within the report directory.',
          });
          continue;
        }
        try {
          caseCoverage.push({
            metadata: { terminal: loadTerminalBundle(bundleDir).metadata },
            type: 'terminal',
          });
        } catch (error) {
          errors.push({
            path: `cases[${index}].evidence[${evidenceIndex}].path`,
            message: `Terminal evidence bundle "${evidence.path}" is invalid: ${(error as Error).message}`,
          });
        }
        continue;
      }
      caseCoverage.push({ type: inferredType });

      const relativePath = path.relative(absoluteReportDir, absoluteEvidencePath);
      const escapesReportDir =
        relativePath === '..' ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath);
      if (path.isAbsolute(evidence.path) || escapesReportDir) {
        errors.push({
          path: `cases[${index}].evidence[${evidenceIndex}].path`,
          message: 'Evidence path must stay within the report directory.',
        });
      } else {
        try {
          await access(absoluteEvidencePath, constants.R_OK);
          const realEvidencePath = await realpath(absoluteEvidencePath);
          const realRelativePath = path.relative(realReportDir, realEvidencePath);
          const realPathEscapes =
            realRelativePath === '..' ||
            realRelativePath.startsWith(`..${path.sep}`) ||
            path.isAbsolute(realRelativePath);
          if (realPathEscapes) {
            errors.push({
              path: `cases[${index}].evidence[${evidenceIndex}].path`,
              message: 'Evidence path resolves outside the report directory.',
            });
          } else if (!(await stat(realEvidencePath)).isFile()) {
            errors.push({
              path: `cases[${index}].evidence[${evidenceIndex}].path`,
              message: `Referenced evidence path "${evidence.path}" is not a regular file.`,
            });
          }
        } catch {
          errors.push({
            path: `cases[${index}].evidence[${evidenceIndex}].path`,
            message: `Referenced evidence file "${evidence.path}" does not exist or cannot be read.`,
          });
        }
      }
      if ('chapters' in evidence && evidence.chapters !== undefined) {
        const rawChapters = evidence.chapters;
        const parsedChapters = reportEvidence([evidence])[0]?.chapters;
        if (
          !Array.isArray(rawChapters) ||
          (Array.isArray(rawChapters) && (parsedChapters?.length ?? 0) !== rawChapters.length)
        ) {
          errors.push({
            path: `cases[${index}].evidence[${evidenceIndex}].chapters`,
            message: 'Video chapters contain invalid or unsupported entries.',
          });
        }
      }
    }

    if (item.status === 'pass' || item.status === 'passed') {
      const planItemIndex = report.plan.findIndex((plan) => plan.id === item.id);
      const planItem = report.plan[planItemIndex];
      if (planItem) {
        for (const [requiredIndex, required] of planItem.requiredEvidence.entries()) {
          const spec = typeof required === 'string' ? { type: required } : required;
          const execution = (spec as { provenance?: unknown }).provenance === 'execution';
          // The ingest / server coverage rule, including same-medium substitutes
          // and execution provenance — validate must not pass what ingest gates.
          if (
            coverageGaps(
              [{ ...(execution ? { provenance: 'execution' as const } : {}), type: spec.type }],
              caseCoverage,
            ).length > 0
          ) {
            errors.push({
              path: `cases[${index}].evidence`,
              message: `Claimed pass is missing required evidence "${spec.type}"${execution ? ' from a real command execution' : ''} (plan[${planItemIndex}].requiredEvidence[${requiredIndex}]).`,
            });
          }
        }
      }
    }
  }

  const coveredPlanIds = new Set(report.cases.map((item) => item.id));
  const unexecutedIds = report.plan
    .filter((item) => !coveredPlanIds.has(item.id))
    .map((item) => item.id);
  const draft = unexecutedIds.length > 0 || report.cases.length === 0;
  if (draft) {
    warnings.push({
      path: 'cases',
      message:
        unexecutedIds.length > 0
          ? `Partial or unexecuted plan coverage; no outcome is claimed for: ${unexecutedIds.join(', ')}.`
          : 'Draft has no observed cases yet.',
    });
  }
  return {
    valid: errors.length === 0,
    draft,
    errors,
    warnings,
    planItems: report.plan.length,
    cases: report.cases.length,
  };
}
