import { z } from 'zod';

import { CursorPaginationQuerySchema, paginatedListSchema } from '../helpers/pagination';

/**
 * Remote devices on the public REST API — the machines the caller connected
 * with the desktop app or `lh connect`. Every rule (which devices the caller
 * sees, workspace visibility, approved working directories) is the `device`
 * tRPC router's, called server-side; every call to the machine itself goes
 * through the device gateway, the same path agent runs use. These schemas only
 * describe the transport.
 */

// ==================== Shared ====================

export const DeviceIdParamSchema = z.object({
  id: z.string().min(1).max(64).describe('Device id, as listed by `GET /devices`.'),
});

/** A directory on the device: absolute, the way the device reports its working directories. */
const devicePath = (description: string) =>
  z.string().trim().min(1).max(4096).describe(description);

const repoPathQuery = {
  path: devicePath(
    'Absolute path of the git working directory on the device, e.g. one of the device’s `workingDirectories`.',
  ),
};

// ==================== Devices ====================

const DeviceChannelSchema = z.object({
  channel: z
    .string()
    .nullable()
    .describe('Which client holds the connection, e.g. `desktop` or `cli`.'),
  connectedAt: z.string().describe('When this connection was opened (ISO 8601).'),
  hostname: z.string().nullable(),
  platform: z.string().nullable(),
});

const WorkingDirectorySchema = z.object({
  path: z.string().describe('Absolute path on the device.'),
  repoType: z
    .enum(['git', 'github'])
    .nullable()
    .describe('What kind of repository the directory holds, when known.'),
});

export const DeviceSchema = z
  .object({
    architecture: z.string().nullable(),
    channels: z
      .array(DeviceChannelSchema)
      .describe('Live connections; a device is online while it holds at least one.'),
    defaultCwd: z.string().nullable().describe('Directory runs start in when none is named.'),
    friendlyName: z.string().nullable().describe('Name the user gave the device, if any.'),
    hostname: z.string().nullable(),
    id: z.string().describe('Device id.'),
    lastSeen: z.string().describe('Last time the device was connected (ISO 8601).'),
    metadata: z
      .record(z.string(), z.string())
      .nullable()
      .describe('What the client reported about itself, e.g. `appVersion` or `cliVersion`.'),
    online: z.boolean(),
    platform: z.string().nullable(),
    registered: z
      .boolean()
      .describe('False for a connected device that has not been stored yet (it appears briefly).'),
    scope: z
      .enum(['personal', 'workspace'])
      .describe('`personal` — the caller’s own machine; `workspace` — enrolled in the workspace.'),
    visibility: z
      .enum(['private', 'public'])
      .nullable()
      .describe('Workspace devices only: shared with every member, or the enroller’s alone.'),
    workingDirectories: z.array(WorkingDirectorySchema),
  })
  .meta({ id: 'Device' });

export const DeviceListQuerySchema = CursorPaginationQuerySchema;

export const DeviceListResponseSchema = paginatedListSchema(DeviceSchema, { total: true });

const DeviceSystemInfoSchema = z.object({
  arch: z.string(),
  defaultShell: z
    .string()
    .nullable()
    .describe('Shell `POST /devices/{id}/commands` runs in, when the device reports it.'),
  homePath: z.string(),
  workingDirectory: z.string(),
});

const DeviceMetricPointSchema = z.object({
  connected: z.boolean().describe('False when the device was disconnected during the bucket.'),
  cpuPercent: z.number().nullable(),
  diskPercent: z.number().nullable(),
  diskUsedBytes: z.number().nullable(),
  load1: z.number().nullable(),
  memoryPercent: z.number().nullable(),
  memoryUsedBytes: z.number().nullable(),
  observedAt: z.number().describe('Bucket start, epoch milliseconds.'),
});

const DeviceMetricsSchema = z.object({
  bucketMs: z.number().int().describe('Width of each point’s bucket.'),
  cpuCount: z.number().int().nullable(),
  diskTotalBytes: z.number().nullable(),
  from: z.number().describe('Window start, epoch milliseconds.'),
  memoryTotalBytes: z.number().nullable(),
  points: z.array(DeviceMetricPointSchema),
  to: z.number().describe('Window end, epoch milliseconds.'),
});

export const DeviceDetailQuerySchema = z.object({
  metricsWindowMs: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(2 * 24 * 60 * 60 * 1000)
    .optional()
    .describe(
      'How far back the metrics reach, in milliseconds (1 minute – 2 days). Default 1 hour.',
    ),
});

export const DeviceDetailSchema = DeviceSchema.extend({
  metrics: DeviceMetricsSchema.describe(
    'Recent CPU / memory / load / disk, averaged into buckets. Empty points when the device never reported.',
  ),
  systemInfo: DeviceSystemInfoSchema.nullable().describe(
    'What the device reports about itself; null while it is offline.',
  ),
}).meta({ id: 'DeviceDetail' });

// ==================== Files ====================

export const DeviceFileListQuerySchema = z.object({
  path: z
    .string()
    .max(4096)
    .default('')
    .describe('Directory to list, relative to `root`. Empty for the root itself.'),
  root: devicePath('Absolute path of the project directory on the device.'),
});

const DeviceFileEntrySchema = z.object({
  gitIgnored: z.boolean().describe('Whether git ignore rules match the entry.'),
  isDirectory: z.boolean(),
  name: z.string(),
  path: z.string().describe('Absolute path on the device.'),
  relativePath: z.string().describe('Path relative to `root`; directories end with `/`.'),
});

export const DeviceFileListSchema = z.object({
  entries: z.array(DeviceFileEntrySchema),
  truncated: z.boolean().describe('True when the device capped the listing.'),
});

export const DeviceFileContentQuerySchema = z.object({
  path: devicePath('Absolute path of the file on the device.'),
  workingDirectory: devicePath(
    'One of the device’s working directories; the file must lie inside it.',
  ),
});

export const DeviceFileContentSchema = z.object({
  content: z
    .string()
    .nullable()
    .describe(
      'Text content (`type: text`) or base64 bytes (`image` / `document`); null otherwise.',
    ),
  contentType: z.string(),
  encoding: z.enum(['base64', 'utf8']).nullable(),
  path: z.string(),
  type: z
    .enum(['text', 'image', 'document', 'binary', 'pdf', 'video'])
    .describe('`binary` / `pdf` / `video` files are too large or not readable as content.'),
});

export const WriteDeviceFileRequestSchema = z.object({
  content: z
    .string()
    .max(5 * 1024 * 1024)
    .describe('Text content to write, replacing the file.'),
  path: devicePath('Absolute path of the file on the device.'),
  workingDirectory: devicePath(
    'One of the device’s working directories; the file must lie inside it.',
  ),
});

export const DeviceFileWriteResultSchema = z.object({
  path: z.string(),
  written: z.literal(true),
});

// ==================== Git ====================

export const DeviceGitQuerySchema = z.object(repoPathQuery);

export const DeviceGitStatusSchema = z.object({
  ahead: z.number().int().nullable().describe('Commits the branch is ahead of its upstream.'),
  behind: z.number().int().nullable().describe('Commits the branch is behind its upstream.'),
  branch: z.string().nullable().describe('Branch name, or short SHA when detached.'),
  clean: z.boolean(),
  counts: z.object({
    added: z.number().int(),
    deleted: z.number().int(),
    modified: z.number().int(),
    total: z.number().int(),
  }),
  detached: z.boolean(),
  files: z.object({
    added: z.array(z.string()),
    deleted: z.array(z.string()),
    modified: z.array(z.string()),
  }),
  upstream: z.string().nullable(),
});

const GIT_REF_REGEX = /^[\w.@/-]+$/;

export const DeviceGitLogQuerySchema = DeviceGitQuerySchema.extend({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('Commits to return, newest first.'),
  ref: z
    .string()
    .max(255)
    .regex(GIT_REF_REGEX, 'Invalid git ref')
    .refine((value) => !value.startsWith('-'), 'Invalid git ref')
    .optional()
    .describe('Branch, tag or commit to start from. Defaults to HEAD.'),
});

const DeviceGitCommitSchema = z.object({
  authorEmail: z.string(),
  authorName: z.string(),
  committedAt: z.string().describe('Author date (ISO 8601).'),
  sha: z.string(),
  shortSha: z.string(),
  subject: z.string(),
});

export const DeviceGitLogSchema = z.object({
  commits: z.array(DeviceGitCommitSchema),
});

export const DeviceGitDiffQuerySchema = DeviceGitQuerySchema.extend({
  baseRef: z
    .string()
    .max(255)
    .regex(GIT_REF_REGEX, 'Invalid git ref')
    .optional()
    .describe('With `against: branch`, the base to diff against; the default branch when omitted.'),
  against: z
    .enum(['workingTree', 'branch'])
    .default('workingTree')
    .describe(
      '`workingTree` — uncommitted changes; `branch` — the current branch against its base.',
    ),
});

const DeviceGitFilePatchSchema = z.object({
  additions: z.number().int(),
  deletions: z.number().int(),
  filePath: z.string().describe('Repository-relative path.'),
  isBinary: z.boolean(),
  patch: z.string().describe('Unified diff; empty when binary or truncated.'),
  status: z.enum(['added', 'modified', 'deleted']),
  truncated: z.boolean(),
});

export const DeviceGitDiffSchema = z.object({
  baseRef: z.string().nullable(),
  headRef: z.string().nullable(),
  patches: z.array(DeviceGitFilePatchSchema),
  submodules: z.array(
    z.object({
      name: z.string(),
      patches: z.array(DeviceGitFilePatchSchema),
      relativePath: z.string(),
    }),
  ),
});

export const DeviceGitOperationRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('checkout'),
    branch: z.string().min(1).max(255).regex(GIT_REF_REGEX, 'Invalid git ref'),
    create: z.boolean().optional().describe('Create the branch first.'),
    path: repoPathQuery.path,
    startPoint: z
      .string()
      .max(255)
      .regex(GIT_REF_REGEX, 'Invalid git ref')
      .optional()
      .describe('With `create`, cut the new branch from this ref instead of HEAD.'),
  }),
  z.object({
    action: z.enum(['pull', 'push']),
    branch: z
      .string()
      .max(255)
      .regex(GIT_REF_REGEX, 'Invalid git ref')
      .optional()
      .describe('Sync this local branch instead of HEAD.'),
    path: repoPathQuery.path,
  }),
]);

export const DeviceGitOperationResultSchema = z.object({
  action: z.enum(['checkout', 'pull', 'push']),
  branch: z.string().nullable(),
  error: z.string().nullable(),
  noop: z.boolean().describe('True when git reported nothing to do.'),
  success: z.boolean(),
});

// ==================== Commands ====================

export const RunDeviceCommandRequestSchema = z.object({
  command: z
    .string()
    .trim()
    .min(1)
    .max(32_000)
    .describe('Shell command, run in the device’s shell.'),
  description: z
    .string()
    .max(200)
    .optional()
    .describe('What the command does; shown wherever the device records it.'),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(600_000)
    .default(60_000)
    .describe(
      'How long to wait for output. A command still running then keeps running and returns `running: true` with its `shellId`.',
    ),
});

export const DeviceCommandResultSchema = z.object({
  exitCode: z.number().int().nullable().describe('Set once the command exited normally.'),
  output: z.string().describe('Combined console output collected during the wait.'),
  running: z.boolean(),
  shellId: z.string().nullable().describe('Id of the shell session while the command runs.'),
  stderr: z.string().nullable(),
  stdout: z.string().nullable(),
  success: z.boolean(),
});

export type DeviceResponse = z.infer<typeof DeviceSchema>;
export type DeviceDetailResponse = z.infer<typeof DeviceDetailSchema>;
export type DeviceFileListResponse = z.infer<typeof DeviceFileListSchema>;
export type DeviceFileContentResponse = z.infer<typeof DeviceFileContentSchema>;
export type DeviceGitStatusResponse = z.infer<typeof DeviceGitStatusSchema>;
export type DeviceGitLogResponse = z.infer<typeof DeviceGitLogSchema>;
export type DeviceGitDiffResponse = z.infer<typeof DeviceGitDiffSchema>;
export type DeviceGitOperationRequest = z.infer<typeof DeviceGitOperationRequestSchema>;
export type DeviceGitOperationResponse = z.infer<typeof DeviceGitOperationResultSchema>;
export type DeviceCommandResponse = z.infer<typeof DeviceCommandResultSchema>;
export type RunDeviceCommandRequest = z.infer<typeof RunDeviceCommandRequestSchema>;
export type WriteDeviceFileRequest = z.infer<typeof WriteDeviceFileRequestSchema>;
export type DeviceDetailQuery = z.infer<typeof DeviceDetailQuerySchema>;
export type DeviceFileListQuery = z.infer<typeof DeviceFileListQuerySchema>;
export type DeviceFileContentQuery = z.infer<typeof DeviceFileContentQuerySchema>;
export type DeviceGitQuery = z.infer<typeof DeviceGitQuerySchema>;
export type DeviceGitLogQuery = z.infer<typeof DeviceGitLogQuerySchema>;
export type DeviceGitDiffQuery = z.infer<typeof DeviceGitDiffQuerySchema>;
