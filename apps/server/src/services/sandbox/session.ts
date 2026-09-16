import {
  DEFAULT_SANDBOX_MODE,
  isSafeSandboxCwd,
  type SandboxMode,
  type SandboxWorkspaceClaim,
} from '@lobechat/builtin-tool-cloud-sandbox';
import type { LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';

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
 * leaving `sandboxCwd` untouched on the topic is what lets a lapsed
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

    const storedCwd = topic.metadata.sandboxCwd;
    const cwd =
      typeof storedCwd === 'string' && isSafeSandboxCwd(storedCwd) ? storedCwd : undefined;
    if (storedCwd && !cwd) {
      log('Ignoring unusable sandboxCwd on topic %s: %o', topicId, storedCwd);
    }

    return { claim, cwd, mode: 'persistent' };
  } catch (error) {
    log('Failed to read sandbox preferences for topic %s: %O', topicId, error);
    return { claim, mode: DEFAULT_SANDBOX_MODE };
  }
};
