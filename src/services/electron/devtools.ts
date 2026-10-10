import type { AppProcessMetrics, GpuStatus, MemoryDump } from '@lobechat/electron-client-ipc';
import type { ManagedProcessSnapshot } from '@lobechat/utils/managedProcess';

import { ensureElectronIpc } from '@/utils/electron/ipc';

class DevtoolsService {
  getManagedProcesses(): Promise<ManagedProcessSnapshot> {
    return ensureElectronIpc().devtools.getManagedProcesses();
  }
  stopManagedProcess(id: string): Promise<void> {
    return ensureElectronIpc().devtools.stopManagedProcess({ id });
  }
  openProcessExplorer(): Promise<void> {
    return ensureElectronIpc().devtools.openProcessExplorer();
  }
  /** Route the main window from a secondary one (e.g. Process Explorer). */
  openInMainWindow(path: string, options?: { escape?: boolean }): Promise<void> {
    return ensureElectronIpc().windows.openInMainWindow({ ...options, path });
  }
  async openDevtools(): Promise<void> {
    return ensureElectronIpc().devtools.openDevtools();
  }

  async getAppProcessMetrics(): Promise<AppProcessMetrics> {
    return ensureElectronIpc().devtools.getAppProcessMetrics();
  }

  async collectRendererGarbage(): Promise<void> {
    return ensureElectronIpc().devtools.collectRendererGarbage();
  }

  async captureMemoryDump(): Promise<MemoryDump> {
    return ensureElectronIpc().devtools.captureMemoryDump();
  }

  async getGpuStatus(): Promise<GpuStatus> {
    return ensureElectronIpc().devtools.getGpuStatus();
  }
}

export const electronDevtoolsService = new DevtoolsService();
