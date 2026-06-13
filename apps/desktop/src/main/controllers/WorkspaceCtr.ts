import {
  initWorkspace as runInitWorkspace,
  listProjectSkills as runListProjectSkills,
  statPath as runStatPath,
  type WorkspaceScanDeps,
} from '@lobechat/device-control';
import {
  type InitWorkspaceParams,
  type InitWorkspaceResult,
  type ListProjectSkillsParams,
  type ListProjectSkillsResult,
} from '@lobechat/electron-client-ipc';

import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:WorkspaceCtr');

/**
 * WorkspaceCtr
 *
 * Thin IPC layer over `@lobechat/device-control`'s workspace-scan helpers
 * (skills discovery under `.agents/skills` / `.claude/skills` + project-root
 * instructions). The scan logic is shared with the device-control RPC dispatch
 * so the local desktop IPC path, the remote device RPC, and the CLI all run
 * identical scans; the desktop-only preview-protocol approval is injected here.
 */
export default class WorkspaceCtr extends ControllerModule {
  static override readonly groupName = 'workspace';

  private get scanDeps(): WorkspaceScanDeps {
    return { approveProjectRoot: (root) => this.approveProjectRootForPreview(root) };
  }

  @IpcMethod()
  async listProjectSkills(params: ListProjectSkillsParams): Promise<ListProjectSkillsResult> {
    return runListProjectSkills(params, this.scanDeps);
  }

  @IpcMethod()
  async initWorkspace(params: InitWorkspaceParams): Promise<InitWorkspaceResult> {
    return runInitWorkspace(params, this.scanDeps);
  }

  @IpcMethod()
  async statPath(params: {
    path: string;
  }): Promise<{ exists: boolean; isDirectory: boolean; repoType?: 'git' | 'github' }> {
    return runStatPath(params);
  }

  private async approveProjectRootForPreview(root: string) {
    try {
      await this.app.localFileProtocolManager.approveIndexedProjectRoot(root);
    } catch (error) {
      logger.error(`Failed to approve project preview root ${root}:`, error);
    }
  }
}
