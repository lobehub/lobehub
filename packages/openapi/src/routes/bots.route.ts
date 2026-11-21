import { Hono } from 'hono';

import { example } from '../common/examples';
import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { BotController } from '../controllers/bot.controller';
import { requireAuth } from '../middleware/auth';
import { requireApiKeyScope } from '../middleware/permission-check';
import {
  BotConnectionTestSchema,
  BotIdParamSchema,
  BotListQuerySchema,
  BotListResponseSchema,
  BotMessageSentSchema,
  BotSchema,
  CreateBotRequestSchema,
  SendBotMessageRequestSchema,
  UpdateBotRequestSchema,
} from '../types/bot.type';
import { DeletedResourceSchema } from '../types/common.type';

/**
 * Agent bot routes.
 *
 * A bot connects an agent to a chat platform — Discord, Slack, Telegram … or a
 * custom webhook channel (`platform: "webhook"`) that lets any platform talk to
 * an agent through signed HTTP POSTs. Bots live in the resolved space (personal,
 * or the `X-Workspace-Id` workspace). Reads gate on `bot:read`; everything that
 * changes a bot or speaks through it gates on `bot:write`, and inside a
 * workspace only the bot's creator or a workspace owner may change it.
 */
const BotRoutes = new Hono();

const botRead = requireApiKeyScope('bot:read');
const botWrite = requireApiKeyScope('bot:write');

const TAGS = ['bots'];

/** GET /api/v1/bots */
BotRoutes.get(
  '/',
  routeDoc({
    data: BotListResponseSchema,
    description: 'Bots in this space, most recently updated first. Credentials are always masked.',
    operationId: 'bots.list',
    summary: 'List bots',
    tags: TAGS,
  }),
  requireAuth,
  botRead,
  zValidator('query', BotListQuerySchema),
  async (c) => new BotController().listBots(c),
);

/** POST /api/v1/bots */
BotRoutes.post(
  '/',
  routeDoc({
    data: BotSchema,
    description:
      'Wires an agent to a platform. Credentials are checked against the platform schema (400 on a bad format); an application id already bound anywhere answers 409. An enabled bot (the default) is connected right away — a failed connect shows in `runtimeStatus`. For `platform: "webhook"`, point your platform at `POST /api/agent/webhooks/custom/{applicationId}` and see the Custom Webhook channel docs for the message format.',
    errors: [404, 409],
    operationId: 'bots.create',
    requestExample: example(CreateBotRequestSchema, {
      agentId: 'agt_xxxxxxxx',
      applicationId: 'my-support-bot',
      credentials: {
        callbackUrl: 'https://example.com/lobehub/callback',
        signingSecret: 'whsec_replace_with_at_least_32_random_chars',
      },
      platform: 'webhook',
    }),
    status: 201,
    summary: 'Create a bot',
    tags: TAGS,
  }),
  requireAuth,
  botWrite,
  zValidator('json', CreateBotRequestSchema),
  async (c) => new BotController().createBot(c),
);

/** GET /api/v1/bots/:id */
BotRoutes.get(
  '/:id',
  routeDoc({
    data: BotSchema,
    errors: [404],
    operationId: 'bots.get',
    summary: 'Get a bot',
    tags: TAGS,
  }),
  requireAuth,
  botRead,
  zValidator('param', BotIdParamSchema),
  async (c) => new BotController().getBot(c),
);

/** PATCH /api/v1/bots/:id */
BotRoutes.patch(
  '/:id',
  routeDoc({
    data: BotSchema,
    description:
      'Change the application id, credentials or settings. Send `credentials` back with the masked values you read to keep those secrets. Use `/enable` and `/disable` to turn the bot on or off.',
    errors: [404, 409],
    operationId: 'bots.update',
    summary: 'Update a bot',
    tags: TAGS,
  }),
  requireAuth,
  botWrite,
  zValidator('param', BotIdParamSchema),
  zValidator('json', UpdateBotRequestSchema),
  async (c) => new BotController().updateBot(c),
);

/** DELETE /api/v1/bots/:id */
BotRoutes.delete(
  '/:id',
  routeDoc({
    data: DeletedResourceSchema,
    description: 'Disconnects the bot and deletes it. The application id is free to bind again.',
    errors: [404],
    operationId: 'bots.delete',
    summary: 'Delete a bot',
    tags: TAGS,
  }),
  requireAuth,
  botWrite,
  zValidator('param', BotIdParamSchema),
  async (c) => new BotController().deleteBot(c),
);

/** POST /api/v1/bots/:id/enable */
BotRoutes.post(
  '/:id/enable',
  routeDoc({
    data: BotSchema,
    description: 'Turns the bot on and connects it to its platform.',
    errors: [404, 412],
    operationId: 'bots.enable',
    summary: 'Enable a bot',
    tags: TAGS,
  }),
  requireAuth,
  botWrite,
  zValidator('param', BotIdParamSchema),
  async (c) => new BotController().enableBot(c),
);

/** POST /api/v1/bots/:id/disable */
BotRoutes.post(
  '/:id/disable',
  routeDoc({
    data: BotSchema,
    description:
      'Turns the bot off and disconnects it; inbound messages are ignored until it is enabled again.',
    errors: [404],
    operationId: 'bots.disable',
    summary: 'Disable a bot',
    tags: TAGS,
  }),
  requireAuth,
  botWrite,
  zValidator('param', BotIdParamSchema),
  async (c) => new BotController().disableBot(c),
);

/** POST /api/v1/bots/:id/test */
BotRoutes.post(
  '/:id/test',
  routeDoc({
    data: BotConnectionTestSchema,
    description:
      'Checks the stored credentials against the platform. For `webhook`, sends a signed `bot.ping` event to the callback URL and passes only on a 2xx. A failed check still answers 200 — read `valid` and `errors`. The bot must be enabled (409 otherwise).',
    errors: [404, 409],
    operationId: 'bots.test',
    summary: 'Test the connection',
    tags: TAGS,
  }),
  requireAuth,
  botWrite,
  zValidator('param', BotIdParamSchema),
  async (c) => new BotController().testBot(c),
);

/** POST /api/v1/bots/:id/messages */
BotRoutes.post(
  '/:id/messages',
  routeDoc({
    data: BotMessageSentSchema,
    description:
      'Posts a message as the bot into a platform channel. For `webhook`, LobeHub delivers it to your callback URL as a signed `bot.message.created` event. The bot must be enabled (409 otherwise).',
    errors: [400, 404, 409],
    operationId: 'bots.sendMessage',
    requestExample: example(SendBotMessageRequestSchema, {
      channelId: 'conv_42',
      content: 'Your order has shipped.',
    }),
    status: 201,
    summary: 'Send a message as the bot',
    tags: TAGS,
  }),
  requireAuth,
  botWrite,
  zValidator('param', BotIdParamSchema),
  zValidator('json', SendBotMessageRequestSchema),
  async (c) => new BotController().sendBotMessage(c),
);

export default BotRoutes;
