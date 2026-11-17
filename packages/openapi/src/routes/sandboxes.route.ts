import { Hono } from 'hono';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { SandboxController } from '../controllers/device.controller';
import { requireAuth } from '../middleware/auth';
import { requireApiKeyScope } from '../middleware/permission-check';
import {
  CreateSandboxRequestSchema,
  RunSandboxCommandRequestSchema,
  SandboxCommandResultSchema,
  SandboxFileContentQuerySchema,
  SandboxFileContentSchema,
  SandboxFileListQuerySchema,
  SandboxFileListSchema,
  SandboxFileWriteResultSchema,
  SandboxIdParamSchema,
  SandboxListQuerySchema,
  SandboxListResponseSchema,
  SandboxSchema,
  WriteSandboxFileRequestSchema,
} from '../types/sandbox.type';

/**
 * Sandbox routes — cloud environment instances on the caller's network drive.
 *
 * Reads need `device:read`; creating a sandbox, writing its files and running
 * commands in it need `device:operate`, which full-access keys do not carry.
 * Writes are recorded in the audit log.
 */
const SandboxRoutes = new Hono();

const TAGS = ['sandboxes'];

const deviceRead = requireApiKeyScope('device:read');
const deviceOperate = requireApiKeyScope('device:operate');

const OPERATE_NOTE =
  'Requires the `device:operate` scope, which full-access keys do not carry: tick it explicitly when creating the key. Recorded in the audit log.';

const controller = () => new SandboxController();

SandboxRoutes.get(
  '/',
  routeDoc({
    data: SandboxListResponseSchema,
    description: 'Sandboxes on the drives the caller can use.',
    errors: [400],
    summary: 'List sandboxes',
    tags: TAGS,
  }),
  requireAuth,
  deviceRead,
  zValidator('query', SandboxListQuerySchema),
  async (c) => controller().listSandboxes(c),
);

SandboxRoutes.post(
  '/',
  routeDoc({
    data: SandboxSchema,
    description: `Create a sandbox from one of your code environments and start its build; poll \`GET /sandboxes/{id}\` until \`status\` is \`ready\`. ${OPERATE_NOTE}`,
    errors: [400, 404, 409, 413],
    status: 201,
    summary: 'Create a sandbox',
    tags: TAGS,
  }),
  requireAuth,
  deviceOperate,
  zValidator('json', CreateSandboxRequestSchema),
  async (c) => controller().createSandbox(c),
);

SandboxRoutes.get(
  '/:id',
  routeDoc({
    data: SandboxSchema,
    description: 'One sandbox and its build state.',
    errors: [400, 404],
    summary: 'Get a sandbox',
    tags: TAGS,
  }),
  requireAuth,
  deviceRead,
  zValidator('param', SandboxIdParamSchema),
  async (c) => controller().getSandbox(c),
);

SandboxRoutes.get(
  '/:id/files',
  routeDoc({
    data: SandboxFileListSchema,
    description: 'Entries of a directory inside the sandbox.',
    errors: [400, 404, 502],
    summary: 'List sandbox files',
    tags: TAGS,
  }),
  requireAuth,
  deviceRead,
  zValidator('param', SandboxIdParamSchema),
  zValidator('query', SandboxFileListQuerySchema),
  async (c) => controller().listFiles(c),
);

SandboxRoutes.get(
  '/:id/files/content',
  routeDoc({
    data: SandboxFileContentSchema,
    description: 'Read one text file inside the sandbox.',
    errors: [400, 404, 502],
    operationId: 'sandboxes.readFile',
    summary: 'Read a sandbox file',
    tags: TAGS,
  }),
  requireAuth,
  deviceRead,
  zValidator('param', SandboxIdParamSchema),
  zValidator('query', SandboxFileContentQuerySchema),
  async (c) => controller().readFile(c),
);

SandboxRoutes.put(
  '/:id/files/content',
  routeDoc({
    data: SandboxFileWriteResultSchema,
    description: `Write a text file inside the sandbox, creating its parents. ${OPERATE_NOTE}`,
    errors: [400, 404, 413, 502],
    operationId: 'sandboxes.writeFile',
    summary: 'Write a sandbox file',
    tags: TAGS,
  }),
  requireAuth,
  deviceOperate,
  zValidator('param', SandboxIdParamSchema),
  zValidator('json', WriteSandboxFileRequestSchema),
  async (c) => controller().writeFile(c),
);

SandboxRoutes.post(
  '/:id/commands',
  routeDoc({
    data: SandboxCommandResultSchema,
    description: `Run a shell command in the sandbox directory, in a cloud sandbox session. ${OPERATE_NOTE}`,
    errors: [400, 404, 409],
    operationId: 'sandboxes.runCommand',
    summary: 'Run a sandbox command',
    tags: TAGS,
  }),
  requireAuth,
  deviceOperate,
  zValidator('param', SandboxIdParamSchema),
  zValidator('json', RunSandboxCommandRequestSchema),
  async (c) => controller().runCommand(c),
);

export default SandboxRoutes;
