import type { Context } from 'hono';

import { getRequestClientIP } from '@/utils/requestClientIP';

import { BaseController } from '../common/base.controller';
import { DeviceRestService } from '../services/device.service';
import { SandboxRestService } from '../services/sandbox.service';

type Params = { id: string };

/**
 * Who performed a write, for its audit entry: the API key (when the call was
 * signed with one), the auth type, the client address and — inside a
 * workspace — the caller's role, which the device operate gate reads.
 */
const actorOf = (c: Context) => {
  const authData = c.get('authData') as { apiKeyId?: string } | undefined;

  return {
    apiKeyId: c.get('authType') === 'apikey' ? authData?.apiKeyId : undefined,
    authType: (c.get('authType') as string | null | undefined) ?? undefined,
    ipAddress: getRequestClientIP(c.req.raw.headers),
    workspaceRole: c.get('workspaceRole'),
  };
};

/**
 * Devices controller.
 * Handles HTTP concerns only — the device rules live in the shared `device` procedures.
 */
export class DeviceController extends BaseController {
  private async respond<T>(
    c: Context,
    work: (service: DeviceRestService, params: Params) => Promise<T>,
    message: string,
  ): Promise<Response> {
    try {
      const service = new DeviceRestService(
        await this.getDatabase(),
        this.getUserId(c),
        this.getWorkspaceId(c),
        actorOf(c),
      );
      return this.success(c, await work(service, this.getParams<Params>(c)), message);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async listDevices(c: Context): Promise<Response> {
    try {
      const query = this.getQuery(c);
      const service = new DeviceRestService(
        await this.getDatabase(),
        this.getUserId(c),
        this.getWorkspaceId(c),
      );
      return this.list(c, 'items', await service.listDevices(query), {
        message: 'Devices retrieved',
        pagination: query,
      });
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  getDevice(c: Context) {
    return this.respond(c, (s, p) => s.getDevice(p.id, this.getQuery(c)), 'Device retrieved');
  }

  listFiles(c: Context) {
    return this.respond(c, (s, p) => s.listFiles(p.id, this.getQuery(c)), 'Files retrieved');
  }

  readFile(c: Context) {
    return this.respond(c, (s, p) => s.readFile(p.id, this.getQuery(c)), 'File retrieved');
  }

  async writeFile(c: Context) {
    const body = await this.getBody(c);
    return this.respond(c, (s, p) => s.writeFile(p.id, body), 'File written');
  }

  gitStatus(c: Context) {
    return this.respond(c, (s, p) => s.gitStatus(p.id, this.getQuery(c)), 'Git status retrieved');
  }

  gitLog(c: Context) {
    return this.respond(c, (s, p) => s.gitLog(p.id, this.getQuery(c)), 'Git log retrieved');
  }

  gitDiff(c: Context) {
    return this.respond(c, (s, p) => s.gitDiff(p.id, this.getQuery(c)), 'Git diff retrieved');
  }

  async gitOperate(c: Context) {
    const body = await this.getBody(c);
    return this.respond(c, (s, p) => s.gitOperate(p.id, body), 'Git operation finished');
  }

  async runCommand(c: Context) {
    const body = await this.getBody(c);
    return this.respond(c, (s, p) => s.runCommand(p.id, body), 'Command finished');
  }
}

/**
 * Sandboxes controller.
 * Handles HTTP concerns only — the drive rules live in the shared `sandboxStorage` procedures.
 */
export class SandboxController extends BaseController {
  private async respond<T>(
    c: Context,
    work: (service: SandboxRestService, params: Params) => Promise<T>,
    message: string,
    status = 200,
  ): Promise<Response> {
    try {
      const { workspaceRole: _role, ...actor } = actorOf(c);
      const service = new SandboxRestService(
        await this.getDatabase(),
        this.getUserId(c),
        this.getWorkspaceId(c),
        actor,
      );
      return this.success(c, await work(service, this.getParams<Params>(c)), message, status);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async listSandboxes(c: Context): Promise<Response> {
    try {
      const query = this.getQuery(c);
      const service = new SandboxRestService(
        await this.getDatabase(),
        this.getUserId(c),
        this.getWorkspaceId(c),
      );
      return this.list(c, 'items', await service.listSandboxes(query), {
        message: 'Sandboxes retrieved',
        pagination: query,
      });
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async createSandbox(c: Context) {
    const body = await this.getBody(c);
    return this.respond(c, (s) => s.createSandbox(body), 'Sandbox created', 201);
  }

  getSandbox(c: Context) {
    return this.respond(c, (s, p) => s.getSandbox(p.id), 'Sandbox retrieved');
  }

  listFiles(c: Context) {
    return this.respond(c, (s, p) => s.listFiles(p.id, this.getQuery(c)), 'Files retrieved');
  }

  readFile(c: Context) {
    return this.respond(c, (s, p) => s.readFile(p.id, this.getQuery(c)), 'File retrieved');
  }

  async writeFile(c: Context) {
    const body = await this.getBody(c);
    return this.respond(c, (s, p) => s.writeFile(p.id, body), 'File written');
  }

  async runCommand(c: Context) {
    const body = await this.getBody(c);
    return this.respond(c, (s, p) => s.runCommand(p.id, body), 'Command finished');
  }
}
