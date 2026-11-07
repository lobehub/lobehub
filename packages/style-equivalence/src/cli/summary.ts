import type { CalibrationResult } from '../calibration';
import type { StyleDifference } from '../capture/snapshot';
import type { MutantResult, MutationReport } from '../mutation/run';
import type { Verdict, VerdictItem } from '../verdict';
import type { CaseCategory } from '../verdict/categorize';

export interface SummaryInput {
  base: string;
  calibration: CalibrationResult[];
  cases: Array<{
    category: CaseCategory;
    key: string;
    result: { differingConditions: string[]; rootCauses: StyleDifference[] };
  }>;
  comparisons: number;
  durationMs: number;
  files: string[];
  head: string;
  mutation: Omit<MutationReport, 'mutants'> & {
    mutants: Array<Pick<MutantResult, 'caseKey' | 'description' | 'outcome'>>;
  };
  runDir: string;
  verdict: Pick<Verdict, 'mergeable' | 'reasons'> & {
    items: Array<Pick<VerdictItem, 'category' | 'key'>>;
  };
}

const TOP = 10;

const calibrationLines = ({ calibration }: SummaryInput) => {
  if (!calibration.length) return [];
  const count = (status: CalibrationResult['status']) =>
    calibration.filter((entry) => entry.status === status).length;
  return [
    `calibration ${count('agree')} agree · ${count('mismatch')} mismatch · ${count('inconclusive')} inconclusive`,
    ...calibration
      .filter((entry) => entry.status === 'mismatch')
      .map(
        (entry) =>
          `  mismatch ${entry.fixtureId} (${entry.file}): real mount ${entry.fixture}, synthetic ${entry.synthetic}`,
      ),
  ];
};

const mutationLines = ({ mutation }: SummaryInput) => {
  if (!mutation.requested) return ['mutation off'];
  if (mutation.error) return [`mutation FAILED: ${mutation.error.split('\n')[0]}`];
  if (!mutation.passed)
    return [
      `mutation FAILED ${mutation.caught}/${mutation.evaluated} caught`,
      ...mutation.mutants
        .filter((mutant) => mutant.outcome === 'missed' || mutant.outcome === 'error')
        .map((mutant) => `  ${mutant.outcome} ${mutant.caseKey}  ${mutant.description}`),
    ];
  return [
    `mutation ${mutation.caught}/${mutation.evaluated} caught · ${mutation.equivalent} equivalent dropped (requested ${mutation.requested})`,
  ];
};

const countLine = ({ verdict }: SummaryInput) => {
  const of = (category: VerdictItem['category']) =>
    verdict.items.filter((item) => item.category === category);
  const signoff = of('needs-signoff');
  const files = signoff.filter((item) => item.key.endsWith('|file')).length;
  return `difference ${of('difference').length} · needs sign-off ${signoff.length} (${signoff.length - files} cases · ${files} files) · unpaired ${of('unpaired').length} · blocking ${of('blocking').length} · equal ${of('equal').length}`;
};

export const formatSummary = (input: SummaryInput) => {
  const lines = [
    input.verdict.mergeable
      ? 'verdict mergeable'
      : `verdict not mergeable: ${input.verdict.reasons.join(' · ')}`,
    `style-equivalence ${input.base.slice(0, 7)}..${input.head.slice(0, 7)} · ${input.files.length} files · ${input.cases.length} cases · ${input.comparisons} comparisons · ${Math.round(input.durationMs / 1000)}s`,
    countLine(input),
    ...mutationLines(input),
    ...calibrationLines(input),
  ];
  const differences = input.cases.filter((entry) => entry.category === 'difference').slice(0, TOP);
  if (differences.length) {
    lines.push('Top root causes:');
    for (const entry of differences) {
      const [cause] = entry.result.rootCauses;
      lines.push(
        `  ${entry.key}  ${cause ? `${cause.property}: ${cause.before} → ${cause.after}` : 'difference'}  (${entry.result.differingConditions.length} conditions)`,
      );
    }
  }
  lines.push(`Evidence: ${input.runDir}`);
  return lines.join('\n');
};

export interface StackSummaryInput {
  base: string;
  conflicts: Array<{ files: string[]; id: string }>;
  head: string;
  mergeable: boolean;
  merged: string[];
  resolved: Array<{ files: string[]; id: string }>;
  shards: Array<{
    files: string[];
    id: string;
    result: { runDir: string; verdict: Pick<Verdict, 'mergeable' | 'reasons'> };
  }>;
}

export const formatStack = (input: StackSummaryInput) =>
  [
    `stack verdict ${input.mergeable ? 'mergeable' : 'not mergeable'} · ${input.base.slice(0, 7)}..${input.head.slice(0, 7)} · merged ${input.merged.length} · conflicts ${input.conflicts.length} · shards ${input.shards.length}`,
    ...input.conflicts.map(
      (conflict) => `  conflict #${conflict.id}  ${conflict.files.join(', ')}`,
    ),
    ...input.resolved.map((entry) => `  kept stack side #${entry.id}  ${entry.files.join(', ')}`),
    ...input.shards.map(
      ({ files, id, result }) =>
        `  #${id}  ${result.verdict.mergeable ? 'mergeable' : `not mergeable: ${result.verdict.reasons.join(' · ')}`}  (${files.length} files)  ${result.runDir}`,
    ),
  ].join('\n');
