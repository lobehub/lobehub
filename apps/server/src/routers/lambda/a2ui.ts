import { A2uiExecutionRuntime } from '@lobechat/builtin-tool-a2ui/executionRuntime';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';

/** Stateless, like the server runtime: one instance serves every request. */
const runtime = new A2uiExecutionRuntime();

/**
 * The card tool run on the server for a client-executed Agent run, so the browser never bundles
 * the A2UI catalog schemas, examples and validator: the client executor forwards here.
 */
export const a2uiRouter = router({
  readCardDocs: authedProcedure
    .input(z.object({ components: z.array(z.string()).max(8) }))
    .query(({ input }) => runtime.readCardDocs(input)),

  renderUI: authedProcedure
    .input(z.object({ operations: z.unknown() }))
    .mutation(({ input }) => runtime.renderUI({ operations: input.operations })),
});
