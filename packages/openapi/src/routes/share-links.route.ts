import { isFullAccessApiKey } from '@lobechat/const';
import type { Context, Next } from 'hono';
import { Hono } from 'hono';

import { ApiException } from '../common/errors';
import { example } from '../common/examples';
import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { ShareLinkController } from '../controllers/share-link.controller';
import { requireAuth } from '../middleware/auth';
import { requireApiKeyScope } from '../middleware/permission-check';
import {
  CreateShareLinkRequestSchema,
  ShareLinkParamSchema,
  ShareLinkSchema,
} from '../types/share-link.type';

/**
 * Share link routes: turn the public read-only link of a topic, page, agent or
 * artifact on and off, and read its state.
 *
 * Who may share what is decided by each resource's own share rules (creator,
 * workspace General Access, an agent's topic-share policy, the agent-share
 * feature flag); a resource the caller cannot see is a 404. Agent, page and
 * artifact sharing need the cloud business layer and answer `501
 * feature_unavailable` on a self-hosted instance, where topic links work.
 *
 * API key scopes: `share:read` to read, `share:write` to turn a link on or
 * off — publishing is its own tier, never implied by a resource's write scope.
 * Publishing an agent or an artifact additionally needs a full-access key: a
 * shared agent runs visitors' chats on the owner's budget and an artifact
 * goes live on the workspace's public site, which the tRPC surface keeps from
 * restricted keys too (`agentShare`, `marketDeployments`).
 */
const ShareLinkRoutes = new Hono();

const read = requireApiKeyScope('share:read');
const write = requireApiKeyScope('share:write');
const tags = ['share-links'];

const FULL_ACCESS_TO_PUBLISH: ReadonlySet<string> = new Set(['agent', 'artifact']);

/** Refuse a restricted key publishing an agent or artifact (see the header). */
const publishGate = async (c: Context, next: Next) => {
  const { resourceType } = c.req.valid('json' as never) as { resourceType: string };
  if (
    FULL_ACCESS_TO_PUBLISH.has(resourceType) &&
    c.get('authType') === 'apikey' &&
    !isFullAccessApiKey(c.get('apiKeyScopes') as string[] | null | undefined)
  ) {
    throw new ApiException(
      403,
      'insufficient_scope',
      `insufficient_scope: sharing an ${resourceType} needs a full-access API key`,
    );
  }
  return next();
};

const SHARE_LINK_EXAMPLE = {
  enabled: true,
  resourceId: 'tpc_abc123',
  resourceType: 'topic',
  shareId: 'b3c1f6e2-7f1d-4a59-9d0b-1f6c2a8e4d11',
  url: 'https://app.lobehub.com/share/t/b3c1f6e2-7f1d-4a59-9d0b-1f6c2a8e4d11',
  viewCount: null,
} as const;

/** POST /api/v1/share-links — turn a public link on (idempotent). */
ShareLinkRoutes.post(
  '/',
  routeDoc({
    data: ShareLinkSchema,
    description:
      'Turns on the public link of a topic, page or agent — re-enabling keeps an agent link’s id and slug — or publishes an artifact from a message. Calling it again on a shared resource returns the same link. Agents and artifacts need a full-access API key.',
    errors: [404, 501],
    operationId: 'shareLinks.enable',
    requestExample: example(CreateShareLinkRequestSchema, {
      resourceId: 'tpc_abc123',
      resourceType: 'topic',
    }),
    responseExample: SHARE_LINK_EXAMPLE,
    summary: 'Enable a share link',
    tags,
  }),
  requireAuth,
  write,
  zValidator('json', CreateShareLinkRequestSchema),
  publishGate,
  async (c) => new ShareLinkController().createShareLink(c),
);

/** GET /api/v1/share-links/:resourceType/:resourceId */
ShareLinkRoutes.get(
  '/:resourceType/:resourceId',
  routeDoc({
    data: ShareLinkSchema,
    description:
      'Whether the resource has a public link, and its URL. A topic, page or agent the caller does not own (or cannot manage) reads as not shared rather than 404, so the answer never reveals whether someone else shared it.',
    errors: [404, 501],
    responseExample: SHARE_LINK_EXAMPLE,
    summary: 'Get a share link',
    tags,
  }),
  requireAuth,
  read,
  zValidator('param', ShareLinkParamSchema),
  async (c) => new ShareLinkController().getShareLink(c),
);

/** DELETE /api/v1/share-links/:resourceType/:resourceId — turn the public link off. */
ShareLinkRoutes.delete(
  '/:resourceType/:resourceId',
  routeDoc({
    data: ShareLinkSchema,
    description:
      'Turns the public link off; visitors lose access at once. A topic link is removed, an agent link paused (re-enabling restores the same URL), a page set back to private and an artifact unpublished.',
    errors: [404, 501],
    operationId: 'shareLinks.disable',
    summary: 'Disable a share link',
    tags,
  }),
  requireAuth,
  write,
  zValidator('param', ShareLinkParamSchema),
  async (c) => new ShareLinkController().deleteShareLink(c),
);

export default ShareLinkRoutes;
