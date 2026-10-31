// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { deviceRouter } from '.';

/**
 * Pins the router's public surface: every procedure path, its kind, and its
 * middleware chain length (which encodes the procedure builder and its input
 * parsers). Splitting the router across files must keep all three.
 */
describe('deviceRouter procedures', () => {
  const procedures = (deviceRouter as any)._def.procedures as Record<string, any>;

  it('exposes exactly the expected procedure paths', () => {
    expect(Object.keys(procedures).sort()).toEqual(expected().map(([name]) => name));
  });

  it.each(expected())('%s is a %s with %i middlewares', (name, type, middlewares) => {
    expect(procedures[name]._def.type).toBe(type);
    expect(procedures[name]._def.middlewares).toHaveLength(middlewares);
  });

  it('accepts Antigravity model discovery requests from connected devices', () => {
    const input = { deviceId: 'device-agy', type: 'antigravity' };
    const schema = procedures.listHeterogeneousAgentModels._def.inputs.at(-1);
    expect(schema.parse(input)).toEqual(input);
    expect(schema.safeParse({ ...input, type: 'unknown-agent' }).success).toBe(false);
  });
});

function expected(): Array<
  [name: string, type: 'mutation' | 'query' | 'subscription', middlewares: number]
> {
  return [
    ['addGitWorktree', 'mutation', 12],
    ['addWorkspaceDeviceWorkingDir', 'mutation', 13],
    ['browseDirectory', 'query', 12],
    ['checkAppUpdate', 'mutation', 12],
    ['checkCapability', 'query', 12],
    ['checkCliUpdate', 'mutation', 12],
    ['checkoutGitBranch', 'mutation', 12],
    ['closeTerminal', 'mutation', 12],
    ['copyAssetForPublish', 'mutation', 15],
    ['copyProjectFiles', 'mutation', 15],
    ['createDirectory', 'mutation', 12],
    ['createProjectDirectory', 'mutation', 15],
    ['createProjectFile', 'mutation', 15],
    ['createTerminalSession', 'mutation', 12],
    ['createTunnel', 'mutation', 12],
    ['deleteGitBranch', 'mutation', 12],
    ['getAgentDeviceBindings', 'query', 12],
    ['getAgentProfile', 'query', 12],
    ['getAntigravityQuota', 'query', 12],
    ['getAppUpdateState', 'query', 12],
    ['getClaudeCodeQuota', 'query', 12],
    ['getCliUpdateState', 'query', 12],
    ['getDeviceActivity', 'query', 12],
    ['getDeviceSystemInfo', 'query', 12],
    ['getGitBranchDiff', 'query', 12],
    ['getGitWorkingTreeFiles', 'query', 12],
    ['getGitWorkingTreePatches', 'query', 12],
    ['getLocalFilePreview', 'query', 14],
    ['getProjectFileIndex', 'query', 12],
    ['getRunningSummary', 'query', 11],
    ['gitAheadBehind', 'query', 12],
    ['gitBranch', 'query', 12],
    ['gitLinkedPullRequest', 'query', 12],
    ['gitPullRequestActivity', 'query', 12],
    ['gitPullRequestDetail', 'query', 12],
    ['gitPullRequestMergeContext', 'query', 12],
    ['gitWorkingTreeStatus', 'query', 12],
    ['installAppUpdate', 'mutation', 12],
    ['listClaudeCodeMemory', 'query', 14],
    ['listDevices', 'query', 11],
    ['listGitBranches', 'query', 12],
    ['listGitRemoteBranches', 'query', 12],
    ['listGitWorktrees', 'query', 12],
    ['listHeterogeneousAgentModels', 'query', 12],
    ['listListeningPorts', 'query', 12],
    ['listProjectDirectory', 'query', 12],
    ['listProjectSkills', 'query', 12],
    ['listTunnels', 'query', 12],
    ['mintWorkspaceConnectToken', 'mutation', 10],
    ['moveProjectFiles', 'mutation', 15],
    ['openTunnel', 'mutation', 12],
    ['pullGitBranch', 'mutation', 12],
    ['pushGitBranch', 'mutation', 12],
    ['readExternalAssetForPublish', 'query', 15],
    ['readTerminal', 'mutation', 12],
    ['register', 'mutation', 12],
    ['registerWorkspaceDevice', 'mutation', 12],
    ['removeDevice', 'mutation', 12],
    ['removeGitWorktree', 'mutation', 12],
    ['removeWorkspaceDevice', 'mutation', 12],
    ['removeWorkspaceDeviceWorkingDir', 'mutation', 13],
    ['renameGitBranch', 'mutation', 12],
    ['renameProjectFile', 'mutation', 15],
    ['resizeTerminal', 'mutation', 12],
    ['restartCli', 'mutation', 12],
    ['revertGitFile', 'mutation', 12],
    ['revokeTunnel', 'mutation', 12],
    ['runGitPullRequestAction', 'mutation', 13],
    ['scanAgents', 'query', 12],
    ['searchProjectFiles', 'query', 12],
    ['setWorkspaceDeviceVisibility', 'mutation', 12],
    ['shareDeviceToWorkspace', 'mutation', 12],
    ['statPath', 'query', 12],
    ['status', 'query', 11],
    ['trashProjectFiles', 'mutation', 15],
    ['updateDevice', 'mutation', 12],
    ['updateDeviceInfo', 'mutation', 12],
    ['updateWorkspaceDevice', 'mutation', 12],
    ['writeProjectFile', 'mutation', 15],
    ['writeTerminal', 'mutation', 12],
  ];
}
