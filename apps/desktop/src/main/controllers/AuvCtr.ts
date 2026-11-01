import AuvService, {
  type AuvConnectionSnapshot,
  type AuvRunCommandParams,
  type AuvRunCommandResult,
} from '@/services/auvSrv';

import { ControllerModule, IpcMethod } from './index';

/** Electron IPC seam for the main-process AUV runtime. */
export default class AuvCtr extends ControllerModule {
  static override readonly groupName = 'auv';

  private get service() {
    return this.app.getService(AuvService);
  }

  /**
   * Connects the Electron main process to AUV and returns its initial inventory.
   *
   * Triggering workflow:
   *
   * {@link IpcMethod}
   *   -> `auv.connect`
   *     -> {@link AuvCtr.connect}
   *
   * Upstream:
   * - Electron renderer IPC invocation of `auv.connect`
   *
   * Downstream:
   * - {@link AuvService.connect}
   */
  @IpcMethod()
  async connect(): Promise<AuvConnectionSnapshot> {
    return this.service.connect();
  }

  /**
   * Disconnects the Electron main process from AUV.
   *
   * Triggering workflow:
   *
   * {@link IpcMethod}
   *   -> `auv.disconnect`
   *     -> {@link AuvCtr.disconnect}
   *
   * Upstream:
   * - Electron renderer IPC invocation of `auv.disconnect`
   *
   * Downstream:
   * - {@link AuvService.disconnect}
   */
  @IpcMethod()
  async disconnect(): Promise<AuvConnectionSnapshot> {
    return this.service.disconnect();
  }

  /**
   * Returns the last serializable AUV connection snapshot.
   *
   * Triggering workflow:
   *
   * {@link IpcMethod}
   *   -> `auv.getStatus`
   *     -> {@link AuvCtr.getStatus}
   *
   * Upstream:
   * - Electron renderer IPC invocation of `auv.getStatus`
   *
   * Downstream:
   * - {@link AuvService.getSnapshot}
   */
  @IpcMethod()
  async getStatus(): Promise<AuvConnectionSnapshot> {
    return this.service.getSnapshot();
  }

  /**
   * Runs one typed AUV CLI command against the app-owned private daemon.
   *
   * Triggering workflow:
   *
   * {@link IpcMethod}
   *   -> `auv.runCommand`
   *     -> {@link AuvCtr.runCommand}
   *
   * Upstream:
   * - `lobe-computer-use/runCommand` client executor
   *
   * Downstream:
   * - {@link AuvService.runCommand}
   */
  @IpcMethod()
  async runCommand(params: AuvRunCommandParams): Promise<AuvRunCommandResult> {
    return this.service.runCommand(params);
  }
}
