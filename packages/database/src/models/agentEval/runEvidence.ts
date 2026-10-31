import { sql } from 'drizzle-orm';

import { agentEvalRuns, agentEvalRunTopics } from '../../schemas';

/** Read saved evidence as well as metrics: older summaries hid partially errored attempts. */
export const hasUnverifiedEvalAttempts = () => sql<boolean>`
  exists (
    select 1 from ${agentEvalRunTopics} as evidence
    where evidence.run_id = ${agentEvalRuns.id}
      and (
        coalesce(evidence.status, '') not in ('passed', 'failed')
        or evidence.passed is null
        or evidence.eval_result ->> 'errorPhase' = 'judge'
        or evidence.eval_result ->> 'error' = 'No assistant output'
        or exists (
          select 1 from jsonb_array_elements(
            case when jsonb_typeof(evidence.eval_result -> 'threads') = 'array'
              then evidence.eval_result -> 'threads' else '[]'::jsonb end
          ) as attempt
          where attempt ->> 'status' in ('error', 'timeout', 'judge_error', 'external', 'running', 'pending')
            or attempt ->> 'error' = 'No assistant output'
            or attempt ->> 'errorPhase' = 'judge'
            or jsonb_typeof(attempt -> 'passed') is distinct from 'boolean'
        )
        or (
          coalesce((${agentEvalRuns.config} ->> 'k')::integer, 1) > 1
          and jsonb_array_length(
            case when jsonb_typeof(evidence.eval_result -> 'threads') = 'array'
              then evidence.eval_result -> 'threads' else '[]'::jsonb end
          ) <> (${agentEvalRuns.config} ->> 'k')::integer
        )
      )
  ) or (
    coalesce((${agentEvalRuns.metrics} ->> 'totalCases')::integer, 0) >
    (select count(*) from ${agentEvalRunTopics} as coverage where coverage.run_id = ${agentEvalRuns.id})
  )
`;
