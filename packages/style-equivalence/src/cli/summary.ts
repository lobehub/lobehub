import type { StyleDifference } from '../capture/snapshot';
import type { CaseCategory } from '../verdict/categorize';

export interface SummaryInput {
  base: string;
  cases: Array<{
    category: CaseCategory;
    key: string;
    result: { differingConditions: string[]; rootCauses: StyleDifference[] };
  }>;
  comparisons: number;
  durationMs: number;
  files: string[];
  head: string;
  runDir: string;
  unpaired: number;
}

const TOP = 10;

export const formatSummary = (input: SummaryInput) => {
  const count = (category: CaseCategory) =>
    input.cases.filter((entry) => entry.category === category).length;
  const lines = [
    `style-equivalence ${input.base.slice(0, 7)}..${input.head.slice(0, 7)} · ${input.files.length} files · ${input.cases.length} cases · ${input.comparisons} comparisons · ${Math.round(input.durationMs / 1000)}s`,
    `difference ${count('difference')} · needs sign-off ${count('needs-signoff') + input.unpaired} · blocking ${count('blocking')} · equal ${count('equal')}`,
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
