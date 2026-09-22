import {
  DEFAULT_SANDBOX_MODE,
  isSafeSandboxCwd,
  isSafeSandboxEnvironmentId,
  type SandboxMode,
  type SandboxWorkspaceClaim,
} from '@lobechat/builtin-tool-cloud-sandbox';
import type { LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';

import { EnvironmentInstanceModel } from '@/database/models/environmentInstance';
import { TopicModel } from '@/database/models/topic';

import { resolveSandboxWorkspaceClaim } from './entitlement';

const log = debug('lobe-server:sandbox:session');

export interface SandboxSessionConfig {
  /**
   * The signed entitlement, or `null` when this run gets no persistent
   * workspace. Independent of {@link mode}: the workspace exists whether or not
   * THIS topic writes to it, and the file browser reads it from an ephemeral
   * topic just as well.
   */
  claim: SandboxWorkspaceClaim | null;
  /**
   * Chosen subdirectory of the workspace, relative to its root. Only ever set
   * on a run that is actually persistent.
   */
  cwd?: string;
  /**
   * Snapshot to restore, or `undefined` for the caller's default. This is the
   * INSTANCE's id, not the environment's: what was installed belongs to one
   * instance, so two instances of one environment restore separately and
   * capture separately.
   *
   * Carries the same invariant as {@link SandboxSessionConfig.mode}: a session
   * is bound to one of these on its first call, so every call for a topic has
   * to agree or the snapshot at the end is refused.
   */
  environment?: string;
  mode: SandboxMode;
}

interface SandboxSessionConfigInput {
  /** See `resolveSandboxWorkspaceClaim` — a visitor run never gets an entitlement. */
  isShareVisitorRun: boolean;
  /**
   * Optional because some runtimes are constructed without one. No database
   * means no plan and no preferences to read, which is exactly the shape of
   * "not entitled" — so the run stays ephemeral rather than half-configured.
   */
  serverDB?: LobeChatDatabase;
  topicId?: string;
  userId: string;
  workspaceId?: string | null;
}

/**
 * Everything the sandbox layer needs to know about persistence for one run,
 * resolved once: the entitlement that goes on the trust token, and the topic's
 * own preferences that go on each request.
 *
 * The topic is only consulted when an entitlement exists. Without one the
 * execution plane routes to the ephemeral sandbox whatever the request says, so
 * reading the preferences would buy nothing but a query — and deliberately
 * leaving the chosen instance untouched on the topic is what lets a lapsed
 * subscription pick up exactly where it left off.
 *
 * Never throws; a failed lookup degrades to the ephemeral sandbox every session
 * uses today.
 */
export const resolveSandboxSessionConfig = async ({
  isShareVisitorRun,
  serverDB,
  topicId,
  userId,
  workspaceId,
}: SandboxSessionConfigInput): Promise<SandboxSessionConfig> => {
  if (!serverDB) return { claim: null, mode: DEFAULT_SANDBOX_MODE };

  const claim = await resolveSandboxWorkspaceClaim({
    isShareVisitorRun,
    serverDB,
    userId,
    workspaceId,
  });

  if (!claim || !topicId) return { claim, mode: DEFAULT_SANDBOX_MODE };

  try {
    const topic = await new TopicModel(serverDB, userId).findById(topicId);
    if (topic?.metadata?.sandboxMode !== 'persistent') {
      return { claim, mode: DEFAULT_SANDBOX_MODE };
    }

    const instanceId = topic.metadata.sandboxInstanceId;
    if (!instanceId) return { claim, mode: 'persistent' };

    // Deleted, or never this member's. Either way the conversation still runs,
    // at the workspace root under the default environment — the alternative is
    // a topic that cannot run at all until someone edits a database row.
    const instance = await new EnvironmentInstanceModel(
      serverDB,
      userId,
      workspaceId ?? undefined,
    ).findById(instanceId);
    if (!instance) {
      log('Ignoring unresolvable sandboxInstanceId on topic %s: %o', topicId, instanceId);
      return { claim, mode: 'persistent' };
    }

    // The directory and the snapshot are one choice, so a bad half discards the
    // whole instance rather than half of it. Running the instance's packages at
    // the workspace root would put one instance's files under another's
    // captured state, which is the exact mixing separate instances exist to
    // prevent — and it would do it silently.
    const { id, workingDirectory } = instance;
    if (!isSafeSandboxCwd(workingDirectory) || !isSafeSandboxEnvironmentId(id)) {
      log('Ignoring unusable instance %s on topic %s: %o', id, topicId, workingDirectory);
      return { claim, mode: 'persistent' };
    }

    return { claim, cwd: workingDirectory, environment: id, mode: 'persistent' };
  } catch (error) {
    log('Failed to read sandbox preferences for topic %s: %O', topicId, error);
    return { claim, mode: DEFAULT_SANDBOX_MODE };
  }
};
