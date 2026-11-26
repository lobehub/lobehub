import { AGENT_RUN_BOARD_SCOPES, AGENT_RUN_BOARD_WINDOW_HOURS } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentRunBoardModel } from '@/database/models/agentRunBoard';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { buildAgentRunBoard, filterRunsBy } from '@/server/services/agentRunBoard';

const agentRunBoardProcedure = wsCompatProcedure.use(serverDatabase);

export const agentRunBoardRouter = router({
  get: agentRunBoardProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        scope: z.enum(AGENT_RUN_BOARD_SCOPES).default('all'),
        userId: z.string().optional(),
        windowHours: z
          .number()
          .refine((value) => (AGENT_RUN_BOARD_WINDOW_HOURS as readonly number[]).includes(value)),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (!ctx.workspaceId)
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'A workspace is required' });

      try {
        const generatedAt = new Date();
        const windowStart = new Date(generatedAt.getTime() - input.windowHours * 60 * 60_000);
        const model = new AgentRunBoardModel(ctx.serverDB, ctx.workspaceId);
        // The involved scope narrows in the query: the model caps the workspace
        // at 500 runs, so filtering afterwards could show an empty board.
        const scopedRows = await model.listRuns({
          involvedUserId: input.scope === 'involved' ? ctx.userId : undefined,
          now: generatedAt,
          since: windowStart,
        });

        return {
          data: buildAgentRunBoard({
            filterOptionRows: scopedRows,
            generatedAt,
            rows: filterRunsBy(scopedRows, input),
            viewerId: ctx.userId,
            windowStart,
          }),
          success: true,
        };
      } catch (error) {
        console.error('[agentRunBoard:get]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to load the agent run board',
        });
      }
    }),
});
