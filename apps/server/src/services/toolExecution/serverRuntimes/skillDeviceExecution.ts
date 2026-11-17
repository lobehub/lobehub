import type { ToolCallScmCredential } from '@/server/services/scm/requester/toolCallCredential';

/**
 * Device-execution wiring for the exec APIs, present only when the run's
 * execution plan routed a device (`plan.kind === 'device'` — the aiAgent sets
 * `context.activeDeviceId` from exactly that condition). When present,
 * `execScript` runs ON the device instead of the cloud sandbox: skill archives
 * are prepared device-side via the `prepareSkillDirectory` RPC and the command
 * executes through the local-system tool over the device gateway.
 */
export interface SkillDeviceExecution {
  deviceId: string;
  executionTimeoutMs?: number;
  /**
   * The run's resolved Local Sandbox decision (`context.localSandbox`), the
   * same value the local-system device-proxy applies to `runCommand`.
   */
  localSandbox?: boolean;
  /** `context.localSandboxNetwork`; only meaningful with {@link localSandbox}. */
  localSandboxNetwork?: boolean;
  operationId?: string;
  /**
   * Filesystem skills already living on the device (project/device SKILL.md).
   * execScript resolves their SKILL.md directory as cwd, mirroring the
   * prepared-archive skills.
   */
  projectSkills?: { location: string; name: string }[];
  resolveScmCredential: () => Promise<ToolCallScmCredential>;
  /** Lazily resolved workspace principal — see `resolveRunWorkspaceId`. */
  resolveWorkspaceId: () => Promise<string | undefined>;
  /** cwd fallback when no activated skill resolves to a directory. */
  workingDirectory?: string;
}
