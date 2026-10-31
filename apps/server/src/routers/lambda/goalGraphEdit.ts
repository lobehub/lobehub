import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { GoalGraphModel } from '@/database/models/goalGraph';

import { assertWorkspaceRowManageable } from './_helpers/assertWorkspaceRowManageable';
import { goalWriteProcedure, idInput, mapGoalError } from './goalProcedures';

/** Edge kinds a caller may write; `revises` stays internal to exploration. */
const writableEdgeKind = z.enum([
  'contains',
  'answers',
  'decomposes',
  'depends_on',
  'derived_from',
  'investigates',
  'produces',
  'supports',
  'contradicts',
  'leads_to',
]);

/** Hand edits to a Goal Graph's nodes and edges, spread into `goalRouter`. */
export const goalGraphEditProcedures = {
  addEdge: goalWriteProcedure
    .input(
      idInput.extend({
        kind: writableEdgeKind,
        sourceNodeId: z.string().uuid(),
        targetNodeId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input: { id, ...input } }) => {
      try {
        return {
          data: await ctx.goalService.addEdge(
            id,
            input.sourceNodeId,
            input.targetNodeId,
            input.kind,
          ),
          success: true,
        };
      } catch (error) {
        mapGoalError(error, 'addEdge');
      }
    }),

  addNode: goalWriteProcedure
    .input(
      idInput.extend({
        description: z.string().optional(),
        kind: z.enum(['problem', 'experiment', 'task', 'finding', 'decision']),
        scopeId: z.string().uuid().optional(),
        questionId: z.string().uuid().optional(),
        priority: z.number().int().optional(),
        status: z
          .enum(['proposed', 'active', 'waiting', 'resolved', 'rejected', 'retired'])
          .optional(),
        title: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input: { id, ...input } }) => {
      try {
        return { data: await ctx.goalService.addNode(id, input), success: true };
      } catch (error) {
        mapGoalError(error, 'addNode');
      }
    }),

  /**
   * Undo a mis-drawn edge while the Goal is still a draft. Without it, one
   * wrong `depends_on` meant deleting the draft and seeding it again.
   */
  removeEdge: goalWriteProcedure
    .input(
      idInput.extend({
        /** Omit to remove every edge from source to target. */
        kind: writableEdgeKind.optional(),
        reason: z.string().optional(),
        sourceNodeId: z.string().uuid(),
        targetNodeId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input: { id, reason, ...match } }) => {
      try {
        // Same creator-or-owner rule as retire/delete: removal is destructive.
        const goal = await ctx.goalModel.findById(id);
        if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
        assertWorkspaceRowManageable(ctx, goal.userId, 'goal');

        const result = await new GoalGraphModel(
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        ).removeDraftEdges(id, match, reason);
        if (result.status === 'not_found')
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
        if (result.status === 'not_draft')
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: `Only a draft Goal can remove edges; this one is ${result.goalStatus}`,
          });
        if (result.edgeIds.length === 0)
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `No ${match.kind ? `${match.kind} ` : ''}edge from ${match.sourceNodeId} to ${match.targetNodeId}`,
          });
        return {
          data: { edgeIds: result.edgeIds },
          message: `Removed ${result.edgeIds.length} edge(s)`,
          success: true,
        };
      } catch (error) {
        mapGoalError(error, 'removeEdge');
      }
    }),
};
