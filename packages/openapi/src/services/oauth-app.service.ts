import { TRPCError } from '@trpc/server';
import { ZodError } from 'zod';

import type { LobeChatDatabase } from '@/database/type';
import { oauthAppRouter } from '@/server/routers/lambda/oauthApp';

import { BaseService } from '../common/base.service';
import { ApiException } from '../common/errors';
import { buildPageInfo, resolvePagination } from '../helpers/pagination';
import type { DeletedResource } from '../types/common.type';
import type {
  CreatedOAuthApp,
  CreateOAuthAppRequest,
  OAuthApp,
  OAuthAppListQuery,
  UpdateOAuthAppRequest,
} from '../types/oauth-app.type';

type StoredApp = NonNullable<
  Awaited<ReturnType<ReturnType<typeof oauthAppRouter.createCaller>['getById']>>
>;

const toIso = (value: Date | string | null | undefined) =>
  value == null ? null : value instanceof Date ? value.toISOString() : value;

/** The public shape: never the stored (encrypted) secret, only whether one exists. */
const toOAuthApp = (app: StoredApp): OAuthApp => ({
  createdAt: toIso(app.createdAt)!,
  description: app.description ?? null,
  enabled: app.enabled ?? true,
  grants: app.grants,
  hasSecret: app.hasSecret,
  id: app.id,
  lastUsedAt: toIso(app.lastUsedAt),
  logoUri: app.logoUri ?? null,
  name: app.name,
  redirectUris: app.redirectUris,
  scopes: app.scopes,
  tokenEndpointAuthMethod: app.tokenEndpointAuthMethod ?? null,
  type: app.applicationType === 'web' ? 'web' : 'device',
  updatedAt: toIso(app.updatedAt)!,
  workspaceId: app.workspaceId ?? null,
});

/**
 * The procedures' own input rules (redirect-URI and logo checks) refuse with a
 * `ZodError` cause; surface its messages (`redirectUri.insecure`, …) as a
 * validation error instead of the serialized issue list.
 */
const toValidationError = (error: TRPCError) => {
  if (error.code !== 'BAD_REQUEST' || !(error.cause instanceof ZodError)) return;
  return new ApiException(
    400,
    'validation_error',
    [...new Set(error.cause.issues.map((issue) => issue.message))].join('; '),
    error.cause.issues.map((issue) => ({
      message: issue.message,
      path: issue.path.map(String).join('.'),
    })),
  );
};

/**
 * OAuth applications for the REST API. Every call goes through the shared
 * `oauthApp` procedures, so redirect-URI / logo validation, the secret
 * handling (encrypted at rest, plaintext returned once) and the ownership
 * predicate (the caller's personal apps, or the workspace's apps) are the
 * in-app ones. The workspace admin requirement for writes is enforced by the
 * route, because the OSS procedure stub does not carry the role.
 */
export class OAuthAppRestService extends BaseService {
  private readonly ctx: { userId: string; workspaceId?: string };

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.ctx = { userId: this.userId, workspaceId };
  }

  private get apps() {
    return oauthAppRouter.createCaller(this.ctx);
  }

  /** Shared guards throw `TRPCError`; the controller maps its code to the HTTP status. */
  private fail(error: unknown, operation: string): never {
    if (error instanceof TRPCError) throw toValidationError(error) ?? error;
    if (error instanceof ApiException) throw error;
    this.handleServiceError(error, operation);
  }

  private async requireApp(id: string): Promise<StoredApp> {
    const app = await this.apps.getById({ id });
    if (!app) throw this.createNotFoundError('OAuth app not found');
    return app;
  }

  async list(query: OAuthAppListQuery) {
    try {
      const apps = await this.apps.list();
      const window = resolvePagination(query);
      const items = apps.slice(window.offset, window.offset + window.limit).map(toOAuthApp);
      return {
        items,
        ...buildPageInfo({ ...window, returned: items.length, total: apps.length }),
        total: apps.length,
      };
    } catch (error) {
      this.fail(error, 'list OAuth apps');
    }
  }

  async get(id: string): Promise<OAuthApp> {
    try {
      return toOAuthApp(await this.requireApp(id));
    } catch (error) {
      this.fail(error, 'get OAuth app');
    }
  }

  async create(body: CreateOAuthAppRequest): Promise<CreatedOAuthApp> {
    try {
      const { clientSecret, ...app } = await this.apps.create(body);
      return { ...toOAuthApp(app as StoredApp), clientSecret: clientSecret ?? null };
    } catch (error) {
      this.fail(error, 'create OAuth app');
    }
  }

  async update(id: string, body: UpdateOAuthAppRequest): Promise<OAuthApp> {
    try {
      await this.requireApp(id);
      const { enabled, ...value } = body;
      if (Object.keys(value).length > 0) await this.apps.update({ id, value });
      if (enabled !== undefined) await this.apps.setEnabled({ enabled, id });
      return toOAuthApp(await this.requireApp(id));
    } catch (error) {
      this.fail(error, 'update OAuth app');
    }
  }

  async delete(id: string): Promise<DeletedResource> {
    try {
      await this.requireApp(id);
      await this.apps.delete({ id });
      return { deleted: true, id };
    } catch (error) {
      this.fail(error, 'delete OAuth app');
    }
  }

  async rotateSecret(id: string) {
    try {
      const app = await this.requireApp(id);
      if (app.applicationType !== 'web') {
        throw new ApiException(
          409,
          'conflict',
          'Device apps are public clients and have no client secret',
        );
      }
      const { clientSecret } = await this.apps.rotateSecret({ id });
      return { clientSecret, id };
    } catch (error) {
      this.fail(error, 'rotate OAuth app secret');
    }
  }
}
