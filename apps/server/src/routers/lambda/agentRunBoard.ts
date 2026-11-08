import { AGENT_RUN_BOARD_SCOPES, AGENT_RUN_BOARD_WINDOW_HOURS } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentRunBoardModel } from '@/database/models/agentRunBoard';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { buildAgentRunBoard, filterInvolvedRuns } from '@/server/services/agentRunBoard';

const agentRunBoardProcedure = wsCompatProcedure.use(serverDatabase);

export const agentRunBoardRouter = router({
  get: agentRunBoardProcedure
    .input(
      z.object({
        scope: z.enum(AGENT_RUN_BOARD_SCOPES).default('all'),
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
        const allRows = await model.listRuns({ now: generatedAt, since: windowStart });
        const rows =
          input.scope === 'involved'
            ? filterInvolvedRuns(
                allRows,
                ctx.userId,
                new Set(
                  await model.listTopicIdsWithUserMessages(
                    [...new Set(allRows.flatMap((r) => r.topicId ?? []))],
                    ctx.userId,
                  ),
                ),
              )
            : allRows;

        return {
          data: buildAgentRunBoard({ generatedAt, rows, viewerId: ctx.userId, windowStart }),
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
