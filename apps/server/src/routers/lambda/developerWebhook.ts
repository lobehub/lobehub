import { WEBHOOK_EVENT_TYPES } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { DeveloperWebhookError, DeveloperWebhookService } from '@/server/services/developerWebhook';

/**
 * Developer webhooks for the settings page. Endpoints belong to one person in the
 * active space (personal or workspace), the same ownership the REST API
 * (`/api/v1/webhooks`) uses; the service enforces it, so there is no extra role gate.
 */
const developerWebhookProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      developerWebhookService: new DeveloperWebhookService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? null,
      ),
    },
  });
});

const webhookUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === 'https:' || protocol === 'http:';
    } catch {
      return false;
    }
  }, 'url.notWebUrl');

const eventsSchema = z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1);

const descriptionSchema = z.string().trim().max(500).nullish();

const pageSchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).default(0),
  })
  .default({ limit: 50, offset: 0 });

const idInput = z.object({ id: z.string() });

/** Service errors become the matching TRPC codes; anything else is a 500. */
const run = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    if (error instanceof DeveloperWebhookError) {
      throw new TRPCError({
        cause: error,
        code: error.code === 'not_found' ? 'NOT_FOUND' : 'CONFLICT',
        message: error.message,
      });
    }
    console.error(`[developerWebhook:${label}]`, error);
    throw new TRPCError({
      cause: error,
      code: 'INTERNAL_SERVER_ERROR',
      message: `Failed to ${label} webhook`,
    });
  }
};

export const developerWebhookRouter = router({
  /** Returns the endpoint with its plaintext `secret`: the only time it is readable. */
  create: developerWebhookProcedure
    .input(
      z.object({
        description: descriptionSchema,
        enabled: z.boolean().optional(),
        events: eventsSchema,
        url: webhookUrlSchema,
      }),
    )
    .mutation(({ ctx, input }) => run('create', () => ctx.developerWebhookService.create(input))),

  delete: developerWebhookProcedure
    .input(idInput)
    .mutation(({ ctx, input }) =>
      run('delete', () => ctx.developerWebhookService.delete(input.id)),
    ),

  list: developerWebhookProcedure
    .input(pageSchema)
    .query(({ ctx, input }) => run('list', () => ctx.developerWebhookService.list(input))),

  listDeliveries: developerWebhookProcedure
    .input(
      z.object({
        id: z.string(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(({ ctx, input }) =>
      run('list deliveries of', () =>
        ctx.developerWebhookService.listDeliveries(input.id, {
          limit: input.limit,
          offset: input.offset,
        }),
      ),
    ),

  /** Queues the same event again as a new delivery. */
  redeliver: developerWebhookProcedure
    .input(z.object({ deliveryId: z.string(), id: z.string() }))
    .mutation(({ ctx, input }) =>
      run('redeliver', () => ctx.developerWebhookService.redeliver(input.id, input.deliveryId)),
    ),

  /** Returns the endpoint with its new plaintext `secret`; the old one stops working. */
  rotateSecret: developerWebhookProcedure
    .input(idInput)
    .mutation(({ ctx, input }) =>
      run('rotate the secret of', () => ctx.developerWebhookService.rotateSecret(input.id)),
    ),

  /** One synchronous `webhook.test` attempt; returns the delivery with its result. */
  test: developerWebhookProcedure
    .input(idInput)
    .mutation(({ ctx, input }) => run('test', () => ctx.developerWebhookService.test(input.id))),

  update: developerWebhookProcedure
    .input(
      z.object({
        id: z.string(),
        value: z.object({
          description: descriptionSchema,
          enabled: z.boolean().optional(),
          events: eventsSchema.optional(),
          url: webhookUrlSchema.optional(),
        }),
      }),
    )
    .mutation(({ ctx, input }) =>
      run('update', () => ctx.developerWebhookService.update(input.id, input.value)),
    ),
});
