import { Hono } from 'hono';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { DeviceController } from '../controllers/device.controller';
import { requireAuth } from '../middleware/auth';
import { requireApiKeyScope } from '../middleware/permission-check';
import {
  DeviceCommandResultSchema,
  DeviceDetailQuerySchema,
  DeviceDetailSchema,
  DeviceFileContentQuerySchema,
  DeviceFileContentSchema,
  DeviceFileListQuerySchema,
  DeviceFileListSchema,
  DeviceFileWriteResultSchema,
  DeviceGitDiffQuerySchema,
  DeviceGitDiffSchema,
  DeviceGitLogQuerySchema,
  DeviceGitLogSchema,
  DeviceGitOperationRequestSchema,
  DeviceGitOperationResultSchema,
  DeviceGitQuerySchema,
  DeviceGitStatusSchema,
  DeviceIdParamSchema,
  DeviceListQuerySchema,
  DeviceListResponseSchema,
  RunDeviceCommandRequestSchema,
  WriteDeviceFileRequestSchema,
} from '../types/device.type';

/**
 * Device routes.
 *
 * Reads need `device:read`. Every write — a command, a file write, a git
 * operation — needs `device:operate`, which a key only holds when it was
 * ticked by name: full access does not imply it. Writes are recorded in the
 * audit log. With `X-Workspace-Id` the routes address the workspace's
 * devices; without it, the caller's own.
 */
const DeviceRoutes = new Hono();

const TAGS = ['devices'];

const deviceRead = requireApiKeyScope('device:read');
const deviceOperate = requireApiKeyScope('device:operate');

const OPERATE_NOTE =
  'Requires the `device:operate` scope, which full-access keys do not carry: tick it explicitly when creating the key. Recorded in the audit log.';

const controller = () => new DeviceController();

// ==================== Devices ====================

DeviceRoutes.get(
  '/',
  routeDoc({
    data: DeviceListResponseSchema,
    description:
      'Devices the caller can reach, online or not: their own machines, or — with `X-Workspace-Id` — the workspace’s devices they can see.',
    summary: 'List devices',
    tags: TAGS,
  }),
  requireAuth,
  deviceRead,
  zValidator('query', DeviceListQuerySchema),
  async (c) => controller().listDevices(c),
);

DeviceRoutes.get(
  '/:id',
  routeDoc({
    data: DeviceDetailSchema,
    description:
      'One device with its connection state, what it reports about itself, and its recent CPU / memory / load / disk metrics.',
    errors: [400, 404],
    summary: 'Get a device',
    tags: TAGS,
  }),
  requireAuth,
  deviceRead,
  zValidator('param', DeviceIdParamSchema),
  zValidator('query', DeviceDetailQuerySchema),
  async (c) => controller().getDevice(c),
);

// ==================== Files ====================

DeviceRoutes.get(
  '/:id/files',
  routeDoc({
    data: DeviceFileListSchema,
    description: 'One directory level inside a project directory on the device.',
    errors: [400, 404, 503],
    summary: 'List project files',
    tags: TAGS,
  }),
  requireAuth,
  deviceRead,
  zValidator('param', DeviceIdParamSchema),
  zValidator('query', DeviceFileListQuerySchema),
  async (c) => controller().listFiles(c),
);

DeviceRoutes.get(
  '/:id/files/content',
  routeDoc({
    data: DeviceFileContentSchema,
    description:
      'Read one file inside one of the device’s working directories: text as UTF-8, images and documents as base64.',
    errors: [400, 404, 422, 503],
    operationId: 'devices.readFile',
    summary: 'Read a project file',
    tags: TAGS,
  }),
  requireAuth,
  deviceRead,
  zValidator('param', DeviceIdParamSchema),
  zValidator('query', DeviceFileContentQuerySchema),
  async (c) => controller().readFile(c),
);

DeviceRoutes.put(
  '/:id/files/content',
  routeDoc({
    data: DeviceFileWriteResultSchema,
    description: `Write a text file inside one of the device’s working directories, replacing it. ${OPERATE_NOTE}`,
    errors: [400, 404, 422, 503],
    operationId: 'devices.writeFile',
    summary: 'Write a project file',
    tags: TAGS,
  }),
  requireAuth,
  deviceOperate,
  zValidator('param', DeviceIdParamSchema),
  zValidator('json', WriteDeviceFileRequestSchema),
  async (c) => controller().writeFile(c),
);

// ==================== Git ====================

DeviceRoutes.get(
  '/:id/git/status',
  routeDoc({
    data: DeviceGitStatusSchema,
    description:
      'Branch, upstream, ahead/behind counts and the changed files of a git working directory on the device.',
    errors: [400, 404, 503],
    operationId: 'devices.getGitStatus',
    summary: 'Get git status',
    tags: TAGS,
  }),
  requireAuth,
  deviceRead,
  zValidator('param', DeviceIdParamSchema),
  zValidator('query', DeviceGitQuerySchema),
  async (c) => controller().gitStatus(c),
);

DeviceRoutes.get(
  '/:id/git/log',
  routeDoc({
    data: DeviceGitLogSchema,
    description: 'Recent commits of a git working directory on the device, newest first.',
    errors: [400, 404, 413, 422, 503],
    summary: 'Get git log',
    tags: TAGS,
  }),
  requireAuth,
  deviceRead,
  zValidator('param', DeviceIdParamSchema),
  zValidator('query', DeviceGitLogQuerySchema),
  async (c) => controller().gitLog(c),
);

DeviceRoutes.get(
  '/:id/git/diff',
  routeDoc({
    data: DeviceGitDiffSchema,
    description:
      'Per-file patches: the uncommitted changes (`against=workingTree`), or the current branch against its base (`against=branch`).',
    errors: [400, 404, 503],
    summary: 'Get git diff',
    tags: TAGS,
  }),
  requireAuth,
  deviceRead,
  zValidator('param', DeviceIdParamSchema),
  zValidator('query', DeviceGitDiffQuerySchema),
  async (c) => controller().gitDiff(c),
);

DeviceRoutes.post(
  '/:id/git/operations',
  routeDoc({
    data: DeviceGitOperationResultSchema,
    description: `Check out (optionally creating) a branch, or pull / push one, in a git working directory on the device. ${OPERATE_NOTE}`,
    errors: [400, 404, 503],
    operationId: 'devices.runGitOperation',
    summary: 'Run a git operation',
    tags: TAGS,
  }),
  requireAuth,
  deviceOperate,
  zValidator('param', DeviceIdParamSchema),
  zValidator('json', DeviceGitOperationRequestSchema),
  async (c) => controller().gitOperate(c),
);

// ==================== Commands ====================

DeviceRoutes.post(
  '/:id/commands',
  routeDoc({
    data: DeviceCommandResultSchema,
    description: `Run a shell command on the device through the device gateway, the way an agent run does, and return its output. ${OPERATE_NOTE}`,
    errors: [400, 404, 503],
    operationId: 'devices.runCommand',
    summary: 'Run a command',
    tags: TAGS,
  }),
  requireAuth,
  deviceOperate,
  zValidator('param', DeviceIdParamSchema),
  zValidator('json', RunDeviceCommandRequestSchema),
  async (c) => controller().runCommand(c),
);

export default DeviceRoutes;
