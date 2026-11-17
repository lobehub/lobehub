import type { LobeChatDatabase } from '@/database/type';
import { sandboxStorageRouter } from '@/server/routers/lambda/sandboxStorage';
import { MarketService } from '@/server/services/market';
import {
  createSandboxService,
  normalizeSandboxCommandResult,
  resolveSandboxSessionConfig,
} from '@/server/services/sandbox';

import { BaseService } from '../common/base.service';
import { ApiException } from '../common/errors';
import { resolvePagination } from '../helpers/pagination';
import type {
  CreateSandboxRequest,
  RunSandboxCommandRequest,
  SandboxCommandResponse,
  SandboxFileContentQuery,
  SandboxFileContentResponse,
  SandboxFileListQuery,
  SandboxFileListResponse,
  SandboxListQuery,
  SandboxResponse,
  WriteSandboxFileRequest,
} from '../types/sandbox.type';
import type { DeviceAuditActor, DeviceAuditEntry } from './device-audit';
import { recordDeviceAudit, runAudited } from './device-audit';

type SandboxCaller = ReturnType<typeof sandboxStorageRouter.createCaller>;
type Instance = NonNullable<Awaited<ReturnType<SandboxCaller['getInstance']>>>;

const toIso = (value: Date | string) => new Date(value).toISOString();

/**
 * The topic REST commands run their sandbox session under. Not a topic of
 * ours — it is never looked up — but the execution plane keys a session (and
 * the instance lease) to one; one per instance keeps consecutive API calls on
 * the same warm sandbox.
 */
export const sandboxApiTopicId = (instanceId: string) => `openapi-sandbox:${instanceId}`;

const toSandbox = (instance: {
  buildError: string | null;
  createdAt: Date | string;
  drive: 'personal' | 'public' | null | undefined;
  environmentId: string;
  id: string;
  name: string;
  status: string;
  workingDirectory: string;
}): SandboxResponse => ({
  buildError: instance.buildError ?? null,
  createdAt: toIso(instance.createdAt),
  drive: instance.drive ?? null,
  environmentId: instance.environmentId,
  id: instance.id,
  name: instance.name,
  status: instance.status as SandboxResponse['status'],
  workingDirectory: instance.workingDirectory,
});

/**
 * Cloud sandboxes on the public REST API.
 *
 * Listing, creating and file reads/writes go through the `sandboxStorage`
 * tRPC procedures, called server-side, so the drive, visibility and
 * environment-directory rules are the app's own. Commands go through
 * `resolveSandboxSessionConfig` + `createSandboxService` — the sandbox service
 * agent runs use — without the `lh` command rewrite of the client tool
 * route, so a key never receives a minted user token.
 *
 * Every write is recorded with {@link recordDeviceAudit}.
 */
export class SandboxRestService extends BaseService {
  private readonly caller: SandboxCaller;

  constructor(
    db: LobeChatDatabase,
    userId: string | null,
    workspaceId: string | undefined,
    private readonly actor: Omit<DeviceAuditActor, 'userId' | 'workspaceId'> = {},
  ) {
    super(db, userId, workspaceId);
    this.caller = sandboxStorageRouter.createCaller({ userId: this.userId, workspaceId });
  }

  private audit(entry: Omit<DeviceAuditEntry, 'resourceType'>) {
    return recordDeviceAudit(
      this.db,
      { ...this.actor, userId: this.userId, workspaceId: this.workspaceId },
      { ...entry, resourceType: 'sandbox' },
    );
  }

  private audited<T>(
    entry: Omit<DeviceAuditEntry, 'resourceType'>,
    work: () => Promise<T>,
    outcome: (result: T) => Record<string, unknown>,
  ) {
    return runAudited((done) => this.audit(done), entry, work, outcome);
  }

  /** A sandbox the caller may reach, or a 404 — never a hint that someone else's exists. */
  private async requireInstance(id: string): Promise<Instance> {
    const instance = await this.caller.getInstance({ id });
    if (!instance) throw this.createNotFoundError('Sandbox not found');
    return instance;
  }

  /** A path inside the sandbox, as the drive addresses it. */
  private drivePath(instance: Instance, path: string) {
    return path ? `${instance.workingDirectory}/${path}` : instance.workingDirectory;
  }

  private relativePath(instance: Instance, path: string) {
    const prefix = `${instance.workingDirectory}/`;
    if (path === instance.workingDirectory) return '';
    return path.startsWith(prefix) ? path.slice(prefix.length) : path;
  }

  // ==================== Sandboxes ====================

  async listSandboxes(query: SandboxListQuery) {
    const { instances } = await this.caller.listInstances({
      environmentId: query.environmentId,
      withSizes: false,
    });
    const all = instances.map(toSandbox);
    const { limit, offset } = resolvePagination(query);

    return { items: all.slice(offset, offset + limit), total: all.length };
  }

  async getSandbox(id: string): Promise<SandboxResponse> {
    return toSandbox(await this.requireInstance(id));
  }

  async createSandbox(request: CreateSandboxRequest): Promise<SandboxResponse> {
    const created = await this.audited(
      {
        action: 'sandbox.created',
        metadata: {
          environmentId: request.environmentId,
          workingDirectory: request.workingDirectory ?? null,
        },
        // the id is only known once the row exists; until then the environment names it
        resourceId: request.environmentId,
      },
      () =>
        request.workingDirectory
          ? this.caller.createInstance({
              environmentId: request.environmentId,
              name: request.name ?? request.workingDirectory,
              workingDirectory: request.workingDirectory,
            })
          : this.caller.createInstanceForEnvironment({ environmentId: request.environmentId }),
      (instance) => ({
        sandboxId: instance.id,
        success: true,
        workingDirectory: instance.workingDirectory,
      }),
    );

    // What the app's dialog fires next: start the build of an instance that
    // has something to clone or install. Returns once the build has started; a
    // failure to start leaves the sandbox `pending`, which `GET` reports.
    if (created.status === 'pending') {
      await this.caller.startInstanceBuild({ id: created.id }).catch((error: unknown) => {
        console.warn('[openapi] sandbox build did not start', created.id, error);
      });
    }

    return this.getSandbox(created.id);
  }

  // ==================== Files ====================

  async listFiles(id: string, query: SandboxFileListQuery): Promise<SandboxFileListResponse> {
    const instance = await this.requireInstance(id);
    const listing = await this.caller.listFiles({
      drive: instance.drive ?? undefined,
      instanceId: id,
      path: this.drivePath(instance, query.path),
      recursive: query.recursive,
    });

    return {
      entries: listing.entries.map((entry) => ({
        isDirectory: entry.isDirectory,
        modifiedAt: entry.modifiedAt ?? null,
        name: entry.name,
        path: this.relativePath(instance, entry.path),
        size: entry.size ?? null,
      })),
      truncated: listing.truncated,
    };
  }

  async readFile(id: string, query: SandboxFileContentQuery): Promise<SandboxFileContentResponse> {
    const instance = await this.requireInstance(id);
    const file = await this.caller.readFile({
      drive: instance.drive ?? undefined,
      instanceId: id,
      path: this.drivePath(instance, query.path),
    });

    return { content: file.content, mimeType: file.mimeType ?? null, path: query.path };
  }

  async writeFile(id: string, request: WriteSandboxFileRequest) {
    const instance = await this.requireInstance(id);

    await this.audited(
      {
        action: 'sandbox.file_written',
        metadata: { bytes: Buffer.byteLength(request.content), path: request.path },
        resourceId: id,
      },
      // by its path on the drive, not `instanceId`: the sandbox directory is an
      // ordinary folder to write in, and naming the instance is the legacy
      // route into its build state, which the procedure refuses
      () =>
        this.caller.writeFile({
          content: request.content,
          drive: instance.drive ?? undefined,
          path: this.drivePath(instance, request.path),
        }),
      () => ({ success: true }),
    );

    return { path: request.path, written: true as const };
  }

  // ==================== Commands ====================

  async runCommand(id: string, request: RunSandboxCommandRequest): Promise<SandboxCommandResponse> {
    const instance = await this.requireInstance(id);

    const session = await resolveSandboxSessionConfig({
      instanceId: id,
      isShareVisitorRun: false,
      serverDB: this.db,
      userId: this.userId,
      workspaceId: this.workspaceId,
    });
    if (!session.claim) {
      throw new ApiException(403, 'forbidden', 'This account has no persistent sandbox workspace');
    }
    if (session.mode !== 'persistent' || session.environment !== id) {
      throw new ApiException(
        409,
        'conflict',
        `Sandbox ${id} cannot run commands right now (${session.fallback ?? 'unavailable'})`,
      );
    }

    const sandbox = createSandboxService({
      marketService: new MarketService({
        userInfo: {
          sandboxStorage: session.claim,
          userId: this.userId,
          workspaceId: this.workspaceId,
        },
      }),
      sandboxCwd: session.cwd,
      sandboxInitialization: session.initialization,
      sandboxInstanceId: session.environment,
      sandboxMode: session.mode,
      sandboxSpecification: session.specification,
      sandboxWorkingDir: session.workingDir,
      serverDB: this.db,
      topicId: sandboxApiTopicId(id),
      userId: this.userId,
    });

    const entry = {
      action: 'sandbox.command_executed' as const,
      metadata: { command: request.command, workingDirectory: instance.workingDirectory },
      resourceId: id,
    };
    // the dispatch is on record before the sandbox runs it; the outcome follows
    await this.audit({ ...entry, metadata: { ...entry.metadata, phase: 'dispatched' } });

    return this.audited(
      { ...entry, metadata: { ...entry.metadata, phase: 'completed' } },
      async () => {
        const normalized = normalizeSandboxCommandResult(
          await sandbox.callTool('runCommand', {
            command: request.command,
            description: 'Run a command from the LobeHub API',
            timeout: request.timeoutMs,
          }),
        );
        return {
          exitCode: normalized.exitCode,
          output: normalized.output,
          stderr: normalized.stderr ?? null,
          success: normalized.success,
        };
      },
      (result) => ({ exitCode: result.exitCode, success: result.success }),
    );
  }
}
