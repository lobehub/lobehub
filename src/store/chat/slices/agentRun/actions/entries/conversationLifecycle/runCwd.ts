import { isDesktop } from '@lobechat/const';
import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';
import type {
  ChatTopic,
  ConversationContext,
  HeterogeneousProviderConfig,
  LobeAgentAgencyConfig,
  LobeAgentChatConfig,
  WorkingDirConfig,
} from '@lobechat/types';
import { getWorkingDirEffectivePath, getWorkingDirSessionPath } from '@lobechat/types';

import {
  resolveAgentWorkingDirectory,
  resolveAgentWorkingDirectoryConfig,
  resolveTargetDeviceId,
} from '@/helpers/agentWorkingDirectory';
import { resolveExecutionTarget, resolveToolMode } from '@/helpers/executionTarget';
import { globalAgentContextManager } from '@/helpers/GlobalAgentContextManager';
import { deviceService } from '@/services/device';
import type { PendingNewTopicDirectory } from '@/store/chat/slices/topic/initialState';
import { deviceSelectors, getDeviceStoreState } from '@/store/device';
import { ensureElectronIpc } from '@/utils/electron/ipc';

import { resolveProjectDirectoryRun } from '../resolveProjectDirectoryRun';

/** The part of a handoff's source topic a new topic continues in. */
export type SourceTopicDirectory = Pick<
  ChatTopic,
  'metadata' | 'projectId' | 'projectWorkingDirectoryId'
>;

/** The machine a run's cwd lives on, and the execution target that picked it. */
export interface RunMachine {
  deviceId?: string;
  target?: string;
}

/** `local`/`device` fix the run's machine client-side; `auto` is routed by the server. */
const isMachineFixed = (machine: RunMachine) =>
  machine.target === 'local' || machine.target === 'device';

/**
 * Whether a handoff source's directory is KNOWN to be gone on the run's machine
 * — deleted or moved since the source ran. `false` when it cannot be verified
 * (device unreachable, no machine resolved yet): the spawn-time check then still
 * reports `working_directory_not_found` instead of the task silently moving.
 */
const isKnownMissingDirectory = async (path: string, machine: RunMachine): Promise<boolean> => {
  try {
    const stat =
      isDesktop && machine.target === 'local'
        ? await ensureElectronIpc().workspace.statPath({ path })
        : machine.deviceId
          ? await deviceService.statPath(machine.deviceId, path)
          : null;
    return !!stat && (!stat.exists || !stat.isDirectory);
  } catch (error) {
    console.warn('[sendMessage] Could not verify the source working directory:', error);
    return false;
  }
};

/**
 * Route a send into the project directory it runs in (`resolveProjectDirectoryRun`).
 *
 * A blank conversation opened from a project "+" runs in the directory (or just
 * the project) it staged; the new topic is born bound to it. A handoff's new
 * topic continues in its source topic's directory (or project) instead. The
 * receiving agent may be unable to run there (gateway off, fixed to another
 * device, directory unresolvable); it still takes the handoff, falling back to
 * the source's bare cwd (see {@link resolveRunCwd}) or — when the directory is
 * gone from its device — its own default.
 */
export const resolveSendProjectRun = async <T extends { boundDeviceId?: string }>(params: {
  agencyConfig: T | undefined;
  boundDirectoryId: string | null | undefined;
  context: ConversationContext;
  directMentionRoute: boolean;
  isGatewayMode: boolean;
  ownerAgentId: string;
  pendingDirectory: PendingNewTopicDirectory | undefined;
  sourceTopic: SourceTopicDirectory | undefined;
}) => {
  const { context, directMentionRoute, ownerAgentId, pendingDirectory, sourceTopic } = params;
  const createsTopic = !context.topicId && !context.groupId && !directMentionRoute;
  const inheritedTopic = createsTopic ? sourceTopic : undefined;
  const runParams = {
    agencyConfig: params.agencyConfig,
    boundDirectoryId: params.boundDirectoryId,
    isGatewayMode: params.isGatewayMode,
    staged:
      createsTopic && !context.isolatedTopic && pendingDirectory?.agentId === ownerAgentId
        ? pendingDirectory
        : undefined,
  };
  const inherited: PendingNewTopicDirectory | undefined = inheritedTopic?.projectWorkingDirectoryId
    ? { agentId: ownerAgentId, projectWorkingDirectoryId: inheritedTopic.projectWorkingDirectoryId }
    : inheritedTopic?.projectId
      ? { agentId: ownerAgentId, projectId: inheritedTopic.projectId }
      : undefined;
  if (!inherited) return { ...(await resolveProjectDirectoryRun(runParams)), inheritedTopic };

  try {
    const run = await resolveProjectDirectoryRun({ ...runParams, staged: inherited });
    const directory = run.stagedDirectory;
    // The server only checks the device is online on send; the source's bare cwd
    // is this same path, so a gone directory drops the inheritance entirely.
    // Project directories run through the gateway on their device, even this one.
    const machine = { deviceId: directory?.deviceId ?? undefined, target: 'device' };
    if (directory && (await isKnownMissingDirectory(directory.path, machine))) {
      return { ...(await resolveProjectDirectoryRun(runParams)), inheritedTopic: undefined };
    }
    return { ...run, inheritedTopic };
  } catch (error) {
    console.warn('[sendMessage] Source project directory unavailable:', error);
    return { ...(await resolveProjectDirectoryRun(runParams)), inheritedTopic };
  }
};

/**
 * The cwd a run uses: its topic's pinned cwd, else the agent default.
 *
 * A topic's cwd is a bare path that only holds on the machine it was pinned on
 * — never hand another machine's path to this run (mirrors the server's
 * `topicPinFitsDevice`). A new topic may inherit a handoff source's cwd; that
 * has no binding on the new topic yet, so the source must have recorded the
 * machine this run resolves a cwd for — not merely not contradict it.
 */
export const resolveRunCwd = async (params: {
  agentWorkingDirectory: string | undefined;
  agentWorkingDirectoryConfig: WorkingDirConfig | undefined;
  existingTopic: Pick<ChatTopic, 'metadata'> | undefined;
  /** Source topic whose cwd a new topic may inherit; omit when it cannot. */
  inheritedTopic: SourceTopicDirectory | undefined;
  /** Source repo for local CLIs, effective (worktree) path otherwise. */
  resolvePath: (config: WorkingDirConfig | undefined) => string | undefined;
  runMachine: RunMachine;
}): Promise<{ workingDirectory?: string; workingDirectoryConfig?: WorkingDirConfig }> => {
  const { existingTopic, inheritedTopic, resolvePath, runMachine } = params;
  const runCwdDeviceId = runMachine.deviceId;
  const pinnedDeviceId = (existingTopic ?? inheritedTopic)?.metadata?.boundDeviceId;
  // An inherited path needs a known, matching machine: an unpinned legacy source
  // could name an unrelated checkout that merely shares the path here.
  const fits = existingTopic
    ? !pinnedDeviceId || !runCwdDeviceId || pinnedDeviceId === runCwdDeviceId
    : isMachineFixed(runMachine) && !!pinnedDeviceId && pinnedDeviceId === runCwdDeviceId;
  let metadata = fits ? (existingTopic ?? inheritedTopic)?.metadata : undefined;
  // An existing topic's cwd is its own (the spawn guide offers a way back); an
  // inherited one is dropped when it is known to be gone.
  const inheritedPath =
    !existingTopic && metadata
      ? (resolvePath(metadata.workingDirectoryConfig) ?? metadata.workingDirectory)
      : undefined;
  if (inheritedPath && (await isKnownMissingDirectory(inheritedPath, runMachine)))
    metadata = undefined;

  return {
    workingDirectory:
      resolvePath(metadata?.workingDirectoryConfig) ??
      metadata?.workingDirectory ??
      params.agentWorkingDirectory,
    workingDirectoryConfig:
      metadata?.workingDirectoryConfig ??
      (metadata?.workingDirectory
        ? { path: metadata.workingDirectory }
        : params.agentWorkingDirectoryConfig),
  };
};

/**
 * Where a send runs: the effective execution target, the machine it lands on,
 * and the cwd (plus its structured config) for that machine. Moved out of
 * `sendMessage` as one pipeline stage.
 */
export const resolveSendRunCwd = async ({
  agencyConfig,
  chatConfig,
  currentDeviceId,
  draftWorkingDirectory,
  existingTopic,
  heterogeneousProvider,
  inheritedTopic,
  isGatewayMode,
  legacyAgentWorkingDirectory,
  stagedDirectoryPath,
  workspaceScoped,
}: {
  agencyConfig: LobeAgentAgencyConfig | undefined;
  chatConfig: LobeAgentChatConfig | undefined;
  currentDeviceId: string | undefined;
  draftWorkingDirectory?: WorkingDirConfig;
  existingTopic: Pick<ChatTopic, 'metadata'> | undefined;
  heterogeneousProvider: HeterogeneousProviderConfig | undefined;
  inheritedTopic: SourceTopicDirectory | undefined;
  isGatewayMode: boolean;
  legacyAgentWorkingDirectory: string | undefined;
  /** A project's staged directory, which a blank conversation runs in. */
  stagedDirectoryPath: string | undefined;
  workspaceScoped: boolean | undefined;
}) => {
  // Resolve the cwd for every run that lands on a MACHINE — a hetero CLI
  // (in-process `hetero` runtime) and a NATIVE agent alike, as long as the
  // effective target routes to a device. The server can only honour a cwd the
  // client resolved (per-user legacy slot included) if it rides along as the
  // new topic's initial metadata, and a topic that is born unbound renders
  // under "No directory" while every later turn re-resolves the agent-level
  // default. Sandbox/none targets must NOT resolve one: the desktop/home
  // fallback is a local machine path that doesn't exist in an ephemeral cloud
  // sandbox and would pollute the topic's metadata. Plain-chat agents have no
  // execution environment at all, so they stay unbound too.
  const isHeteroRun = !!heterogeneousProvider;
  const runEffectiveTarget =
    isHeteroRun || resolveToolMode(chatConfig) !== 'chat'
      ? resolveExecutionTarget(agencyConfig, {
          clientExecutionAvailable: isDesktop,
          // A web client can't run tools in-process, but its backend may still
          // route a bound `local` target to the user's machine — where the cwd
          // does apply.
          deviceRoutingAvailable: isGatewayMode,
          isHetero: isHeteroRun,
          workspaceScoped,
        })
      : undefined;
  const resolvesRunCwd =
    runEffectiveTarget === 'local' ||
    runEffectiveTarget === 'device' ||
    runEffectiveTarget === 'auto';
  // Same precedence as `useEffectiveWorkingDirectory` (and the server's
  // `resolveDeviceWorkingDirectoryConfig`), but over the MERGED config — the
  // agent selector reads the raw shared row internally, which could fall back
  // to a cwd registered for another member's device.
  const runCwdDeviceId = resolvesRunCwd
    ? resolveTargetDeviceId(agencyConfig, currentDeviceId, { workspaceScoped })
    : undefined;
  // Desktop/home is the last resort for hetero CLIs ONLY: they always spawn in
  // some directory, so an unconfigured agent still needs one. A native agent
  // with nothing configured stays unbound instead — pinning it to `~/Desktop`
  // would file every desktop conversation under a project the user never
  // picked.
  const heteroCwdContext =
    resolvesRunCwd && isHeteroRun && isDesktop ? globalAgentContextManager.getContext() : undefined;
  const runCwdParams = resolvesRunCwd
    ? {
        agencyConfig,
        currentDeviceId,
        deviceDefaultCwd:
          deviceSelectors.getDeviceDefaultCwd(runCwdDeviceId)(getDeviceStoreState()),
        fallback: heteroCwdContext?.desktopPath ?? heteroCwdContext?.homePath,
        legacyAgentWorkingDirectory,
        // A project's staged directory, not the agent default, is the new topic's cwd.
        topicWorkingDirectory: stagedDirectoryPath,
        topicWorkingDirectoryConfig: existingTopic ? undefined : draftWorkingDirectory,
        workspaceScoped,
      }
    : undefined;
  const agentWorkingDirectory = runCwdParams && resolveAgentWorkingDirectory(runCwdParams);
  const agentWorkingDirectoryConfig =
    runCwdParams && resolveAgentWorkingDirectoryConfig(runCwdParams);
  // Heterogeneous CLI agents (Claude Code, Codex, …) store sessions per-cwd
  // (`~/.claude/projects/<encoded-cwd>/`). Anchor their session cwd to the
  // SOURCE repo, NOT the selected worktree, so switching worktree keeps cwd +
  // sessionId consistent and never drops the conversation context. The active
  // worktree lives only in `workingDirectoryConfig.git.activeWorktree` as a
  // record. The per-cwd session store is a LOCAL CLI trait — remote platform
  // agents (openclaw / hermes) run through the gateway with no such
  // constraint, so they (like non-hetero runtimes) keep the effective
  // (worktree) path.
  const isLocalCliHetero =
    !!heterogeneousProvider && !isRemoteHeterogeneousType(heterogeneousProvider.type);
  const resolveWorkingDirPath = isLocalCliHetero
    ? getWorkingDirSessionPath
    : getWorkingDirEffectivePath;
  const { workingDirectory, workingDirectoryConfig } = await resolveRunCwd({
    agentWorkingDirectory,
    agentWorkingDirectoryConfig,
    existingTopic,
    inheritedTopic:
      !draftWorkingDirectory && !stagedDirectoryPath && resolvesRunCwd ? inheritedTopic : undefined,
    resolvePath: resolveWorkingDirPath,
    runMachine: { deviceId: runCwdDeviceId, target: runEffectiveTarget },
  });

  return { runCwdDeviceId, runEffectiveTarget, workingDirectory, workingDirectoryConfig };
};
