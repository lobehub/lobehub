import type { GoalReleaseGateDossier, GoalReleaseGateUnit } from '@lobechat/types';

import { parseSkillMarkdownFrontmatter } from '@/utils/skillMarkdown';

const MAX_UNIT_CODE_LENGTH = 6;
const COSTLY_RATIO = 1.5;

export const splitUnitTitle = (title: string): { code?: string; name: string } => {
  const [code, ...rest] = title.split(' ');
  return rest.length > 0 && code.length <= MAX_UNIT_CODE_LENGTH
    ? { code, name: rest.join(' ') }
    : { name: title };
};

const compactTokens = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
  notation: 'compact',
});

const compactEstimate = new Intl.NumberFormat('en-US', {
  maximumSignificantDigits: 2,
  notation: 'compact',
});

export const formatTokens = (tokens: number) =>
  tokens < 1000 ? String(Math.round(tokens)) : compactTokens.format(tokens);

export const formatTokenEstimate = (tokens: number) => compactEstimate.format(tokens);

const isUnsettled = (unit: GoalReleaseGateUnit) => unit.status !== 'resolved';
const isReworked = (unit: GoalReleaseGateUnit) => unit.runs > 1;

export type UnitRemark =
  | { kind: 'reworked'; rework: number }
  | { kind: 'reworkedCostly'; ratio: string; rework: number }
  | { kind: 'unsettled' };

export const unitRemark = (unit: GoalReleaseGateUnit, average: number): UnitRemark | undefined => {
  if (isUnsettled(unit)) return { kind: 'unsettled' };
  if (!isReworked(unit)) return undefined;
  const rework = unit.runs - 1;
  const ratio = average > 0 ? unit.tokens / average : 0;
  return ratio >= COSTLY_RATIO
    ? { kind: 'reworkedCostly', ratio: ratio.toFixed(1), rework }
    : { kind: 'reworked', rework };
};

const attentionRank = (unit: GoalReleaseGateUnit) => {
  if (isUnsettled(unit)) return 0;
  if (isReworked(unit)) return 1;
  return 2;
};

export const orderUnits = (units: GoalReleaseGateUnit[]) =>
  units.toSorted((a, b) => attentionRank(a) - attentionRank(b));

export const summarizeGate = (
  dossier: Pick<GoalReleaseGateDossier, 'checks' | 'nextWave' | 'remainingAfter' | 'units'>,
) => {
  const average =
    dossier.units.reduce((sum, unit) => sum + unit.tokens, 0) / Math.max(1, dossier.units.length);
  const remaining = dossier.nextWave.length + dossier.remainingAfter;
  return {
    average,
    checks: {
      passed: dossier.checks.filter((check) => check.passed).length,
      total: dossier.checks.length,
    },
    estimate: average * remaining,
    remaining,
    reworked: dossier.units
      .filter(isReworked)
      .map((unit) => splitUnitTitle(unit.title).code ?? unit.title),
    units: orderUnits(dossier.units),
  };
};

const HEADING = /^#{1,6}\s+(.+?)\s*#*$/;
const LINE_MARKER = /^(?:[-*+]|\d+[.)]|>)\s+/;

const plainLine = (line: string) =>
  line
    .trim()
    .replace(LINE_MARKER, '')
    .replaceAll(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replaceAll(/\*\*|__|`/g, '');

export interface PlanDigest {
  hasMore: boolean;
  summary?: string;
  title?: string;
}

export const planDigest = (content: string): PlanDigest => {
  const blocks = parseSkillMarkdownFrontmatter(content)
    .body.split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  let title: string | undefined;
  const [firstLine, ...restLines] = (blocks[0] ?? '').split('\n');
  const heading = firstLine.match(HEADING);
  if (heading) {
    title = plainLine(heading[1]);
    blocks.shift();
    if (restLines.length > 0) blocks.unshift(restLines.join('\n'));
  }

  let summary: string | undefined;
  if (blocks[0] && !HEADING.test(blocks[0].split('\n')[0])) {
    summary = blocks
      .shift()!
      .split('\n')
      .map((line) => plainLine(line))
      .filter(Boolean)
      .join(' ');
  }

  return {
    hasMore: blocks.length > 0,
    ...(summary && { summary }),
    ...(title && { title }),
  };
};
