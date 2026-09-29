import type {
  ISandboxService,
  SandboxExportFileResult,
  SandboxMode,
} from '@lobechat/builtin-tool-cloud-sandbox';
import type { LobeChatDatabase } from '@lobechat/database';

import type { FileService } from '@/server/services/file';
import type { MarketService } from '@/server/services/market';

export type SandboxProviderKind = 'market' | 'onlyboxes';

/**
 * The part of an environment's definition the execution plane acts on while a
 * session runs, as opposed to while it is being built.
 *
 * A deliberate pick rather than the stored object passed through. Two reasons,
 * and the first is the one that matters: `EnvironmentConfiguration` is typed
 * without credentials, but it is `jsonb` — the column accepts whatever was
 * written to it, and this object now travels to the execution plane on every
 * tool call. Naming the fields means a key that appears in the database later
 * cannot start leaving the server just because someone added it upstream.
 *
 * The second is that `bootstrapCommand` and `sources` are here even though a
 * session never runs either: they are two of the three keys the execution
 * plane digests to decide which build a snapshot belongs to. Dropping them
 * would make every session disagree with the build it restored.
 */
export interface SandboxSessionSpecification {
  bootstrapCommand?: string;
  env?: Record<string, string>;
  excludePaths?: string[];
  internetAccess?: boolean;
  maintenanceCommand?: string;
  sources?: { kind: string; path?: string; ref?: string; uri?: string; url?: string }[];
}

export interface SandboxSessionContext {
  /**
   * Working directory inside the persistent workspace, relative to its root.
   * Forwarded with every call; the execution plane composes it onto the
   * directory the entitlement names and fences the result. Only meaningful
   * alongside `sandboxMode: 'persistent'`.
   */
  sandboxCwd?: string;
  /**
   * Named environment to restore for this run; absent means the caller's
   * default. Like `sandboxMode`, every call for a topic must carry the same
   * value — the session binds to one environment on its first call.
   */
  sandboxEnvironment?: string;
  /**
   * Whether this run wants its working directory to survive the session.
   * Absent means ephemeral. Half the decision — the execution plane also
   * requires an entitlement on the trust token, which is minted upstream of
   * this service.
   */
  sandboxMode?: SandboxMode;
  /**
   * The instance's definition, so the execution plane can act on the half of
   * it that belongs to a run rather than to a build: exporting the declared
   * variables, running the maintenance command once, cutting the network when
   * the environment asks for it, and routing the regenerable paths on capture.
   *
   * Carried on every call for the same reason {@link sandboxEnvironment} is —
   * the runtime adopts it per invocation and a call that omitted it would run
   * with whatever the previous one happened to set.
   */
  sandboxSpecification?: SandboxSessionSpecification;
  /**
   * Where commands run, on the sandbox's local disk, for an instance whose
   * checkout lives there. Sent alongside {@link sandboxCwd}, which keeps
   * naming the instance the call belongs to on the volume.
   */
  sandboxWorkingDir?: string;
  topicId: string;
  userId: string;
}

export interface SandboxServiceOptions extends SandboxSessionContext {
  fileService?: FileService;
  marketService: MarketService;
  /** Used to look up topic/session files when bootstrapping the sandbox. */
  serverDB?: LobeChatDatabase;
}

export interface SandboxProviderCapabilities {
  backgroundCommands: boolean;
  exportFile: boolean;
  files: boolean;
  languages: string[];
  persistentSession: boolean;
  shell: boolean;
  skillScripts: boolean;
}

export interface SandboxProvider extends Pick<ISandboxService, 'callTool'> {
  readonly capabilities: SandboxProviderCapabilities;

  exportFileToUploadUrl: (
    request: SandboxProviderFileExportRequest,
  ) => Promise<SandboxProviderFileExportResult>;

  readonly kind: SandboxProviderKind;
}

export interface SandboxService extends ISandboxService {
  readonly capabilities: SandboxProviderCapabilities;
  readonly kind: SandboxProviderKind;
}

export interface SandboxFileExporter {
  exportAndUploadFile: (
    path: string,
    filename: string,
    options?: { storageName?: string },
  ) => Promise<SandboxExportFileResult>;
}

export interface SandboxProviderFileExportRequest {
  filename: string;
  path: string;
  uploadHeaders?: Record<string, string>;
  uploadUrl: string;
}

export interface SandboxProviderFileExportResult {
  error?: SandboxExportFileResult['error'];
  mimeType?: string;
  result?: Record<string, unknown>;
  size?: number;
  success: boolean;
}

export interface SandboxCommandResult {
  exitCode: number;
  output: string;
  /** The provider recreated the workspace before executing this command. */
  sessionExpiredAndRecreated?: boolean;
  stderr?: string;
  success: boolean;
}
