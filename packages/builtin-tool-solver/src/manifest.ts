import { type BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { SolverApiName, SolverIdentifier } from './types';

export const SolverManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Solve a constraint-satisfaction / optimization problem with a domain pack. ' +
        "Formalize the user request into the pack's typed spec and submit it. " +
        'The response status is one of: "optimal" (best-cost plan, all constraints satisfied), ' +
        '"feasible_timeout" (best plan found within the time limit, optimality not proven), ' +
        '"infeasible" (no plan satisfies all constraints — read conflicts[].involvedFields / ' +
        'explanation / suggestedRelaxations and repair the spec, at most 3 repair rounds), or ' +
        '"error" (the spec failed validation; every violation is listed — fix the fields and retry). ' +
        'Feasible statuses include candidate plans with total cost and cost breakdown.',
      name: SolverApiName.solve,
      parameters: {
        additionalProperties: false,
        properties: {
          maxCandidates: {
            description:
              'Maximum number of distinct candidate plans to return (default 3, server-capped).',
            minimum: 1,
            type: 'number',
          },
          pack: {
            description: 'Domain pack id. Currently available: "travelplanner".',
            minLength: 1,
            type: 'string',
          },
          queryId: {
            description:
              'Id selecting the pack\'s reference data for this query, e.g. "validation_0" ' +
              '(format: "<split>_<index0>", splits: train, validation, test).',
            minLength: 1,
            type: 'string',
          },
          spec: {
            description:
              "The pack's typed constraint spec extracted from the user request. For " +
              'travelplanner: { origin, destination: { type: "city"|"state", name }, days, ' +
              'startDate, visitingCityNumber, peopleNumber, budget, houseRule?, roomType?, ' +
              "cuisines?, transportation?, soft? }. Re-check every field against the user's " +
              'original words before solving.',
            type: 'object',
          },
          timeLimitMs: {
            description:
              'Solve time budget in milliseconds (server-capped; the effective value is echoed ' +
              'back in solverMeta.timeLimitMs). Omit to use the server default.',
            minimum: 1,
            type: 'number',
          },
        },
        required: ['pack', 'queryId', 'spec'],
        type: 'object',
      },
    },
    {
      description:
        "Independently verify a plan returned by solve against the pack's constraint checker " +
        '(a second code path, separate from the solver; travelplanner runs the 13 official ' +
        'constraints). Always verify the plan you intend to present. Returns pass plus ' +
        'per-constraint results with details.',
      name: SolverApiName.verify,
      parameters: {
        additionalProperties: false,
        properties: {
          pack: {
            description: 'Domain pack id, same as the solve call that produced the plan.',
            minLength: 1,
            type: 'string',
          },
          plan: {
            description: 'The candidate plan to check, exactly as returned by solve.',
            items: { type: 'object' },
            type: 'array',
          },
          queryId: {
            description: 'Same queryId used for the solve call.',
            minLength: 1,
            type: 'string',
          },
          spec: {
            description: 'Same spec used for the solve call.',
            type: 'object',
          },
        },
        required: ['pack', 'queryId', 'spec', 'plan'],
        type: 'object',
      },
    },
  ],
  identifier: SolverIdentifier,
  meta: {
    avatar: '📐',
    description:
      'Solve constraint-satisfaction and optimization problems (trip planning, scheduling) with exact domain solvers',
    readme:
      'Formalize a constrained request into a typed domain-pack spec, solve it with an exact ' +
      'constraint solver, and verify the plan independently. Infeasible specs come back with ' +
      'structured conflicts and suggested relaxations for a bounded repair loop. Requires a ' +
      'deployed solver service (SOLVER_SERVICE_URL / SOLVER_SERVICE_API_KEY).',
    title: 'Constraint Solver',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
