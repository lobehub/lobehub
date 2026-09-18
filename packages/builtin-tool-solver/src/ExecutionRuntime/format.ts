import type {
  SolveParams,
  SolverCandidate,
  SolveServiceResponse,
  VerifyParams,
  VerifyServiceResponse,
} from '../types';

/**
 * Model-facing content formatters.
 *
 * The model reads `content`, not `state` — every repair signal the service
 * returns (violations, conflicts, relaxations, effective time limit) must be
 * fully rendered here, not just stored in pluginState.
 */

const formatCost = (value?: number): string =>
  typeof value === 'number' ? `$${value.toLocaleString('en-US')}` : 'n/a';

const formatCandidate = (candidate: SolverCandidate, index: number, budget?: number): string => {
  const lines = [`Candidate ${index + 1} — total cost ${formatCost(candidate.totalCost)}`];

  if (typeof budget === 'number' && typeof candidate.totalCost === 'number') {
    lines.push(
      candidate.totalCost <= budget
        ? `within budget ${formatCost(budget)}`
        : `OVER budget ${formatCost(budget)}`,
    );
  }

  if (candidate.costBreakdown) {
    const parts = Object.entries(candidate.costBreakdown)
      .filter(([key]) => key !== 'total')
      .map(([key, value]) => `${key}: ${formatCost(value)}`);
    if (parts.length > 0) lines.push(`cost breakdown — ${parts.join(', ')}`);
  }

  lines.push(`plan:\n${JSON.stringify(candidate.plan, null, 2)}`);
  return lines.join('\n');
};

export const formatSolveContent = (
  params: Pick<SolveParams, 'pack' | 'queryId' | 'spec'>,
  result: SolveServiceResponse,
): string => {
  const meta = result.solverMeta;
  const header = [
    `solve status: ${result.status} (pack: ${params.pack}, query: ${params.queryId})`,
    meta
      ? `solver meta: engine=${meta.engine ?? 'unknown'}, solveMs=${meta.solveMs ?? 'n/a'}, effective timeLimitMs=${meta.timeLimitMs ?? 'server default'}`
      : undefined,
  ]
    .filter(Boolean)
    .join('\n');

  switch (result.status) {
    case 'optimal':
    case 'feasible_timeout': {
      const budget =
        typeof params.spec?.budget === 'number' ? (params.spec.budget as number) : undefined;
      const candidates = (result.candidates ?? []).map((candidate, index) =>
        formatCandidate(candidate, index, budget),
      );
      const timeoutNote =
        result.status === 'feasible_timeout'
          ? 'NOTE: this is the BEST plan found within the time limit — optimality is NOT proven. Verify it before presenting; re-solve once with a larger timeLimitMs if the user needs the optimum.'
          : undefined;

      return [
        header,
        timeoutNote,
        `${candidates.length} candidate plan(s):`,
        ...candidates,
        'Next step: run verify on the candidate you intend to present, then present it with total cost vs budget and the constraints it honors.',
      ]
        .filter(Boolean)
        .join('\n\n');
    }
    case 'infeasible': {
      const conflicts = (result.conflicts ?? []).map((conflict, index) =>
        [
          `${index + 1}. ${conflict.constraint}`,
          conflict.involvedFields?.length
            ? `   fields: ${conflict.involvedFields.map((f) => `$.${f}`).join(', ')}`
            : undefined,
          `   ${conflict.explanation}`,
          conflict.suggestedRelaxations?.length
            ? `   suggested relaxations: ${conflict.suggestedRelaxations.join(' | ')}`
            : undefined,
        ]
          .filter(Boolean)
          .join('\n'),
      );

      return [
        header,
        'No plan satisfies all constraints. Conflicts:',
        ...conflicts,
        "Repair guidance: FIRST re-check every spec field against the user's original request (extraction errors are the most common cause — especially budget scope and days vs visitingCityNumber). If the extraction is faithful, adjust the implicated fields using the suggested relaxations and solve again. At most 3 repair rounds in total; never silently relax a user's hard constraint — state which fields you relaxed and why. If still infeasible after 3 rounds, present the conflicts to the user.",
      ].join('\n\n');
    }
    case 'error': {
      return [
        header,
        `The spec failed validation:\n${result.error ?? 'unknown validation error'}`,
        'Fix the listed spec fields and solve again (this counts toward the 3 repair rounds).',
      ].join('\n\n');
    }
  }
};

export const formatVerifyContent = (
  params: Pick<VerifyParams, 'pack' | 'queryId'>,
  result: VerifyServiceResponse,
): string => {
  const results = result.results ?? [];
  const passed = results.filter((r) => r.pass).length;
  const lines = results.map(
    (r) => `${r.pass ? '✓' : '✗'} ${r.constraint}${r.detail ? ` — ${r.detail}` : ''}`,
  );

  return [
    `verify result: ${result.pass ? 'PASS' : 'FAIL'} (pack: ${params.pack}, query: ${params.queryId}) — ${passed}/${results.length} checks passed`,
    ...lines,
    result.pass
      ? 'The plan passed independent verification and can be presented.'
      : 'The plan FAILED verification — do NOT present it as-is. Present another candidate, or re-solve after re-checking the spec.',
  ].join('\n');
};
