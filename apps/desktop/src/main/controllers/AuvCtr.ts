import AuvService, {
  type AuvConnectionSnapshot,
  type AuvRunCommandParams,
  type AuvRunCommandResult,
} from '@/services/auvSrv';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:AuvCtr');

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
   * - `lobe-auv/runCommand` client executor
   *
   * Downstream:
   * - {@link AuvService.runCommand}
   */
  @IpcMethod()
  async runCommand(params: AuvRunCommandParams): Promise<AuvRunCommandResult> {
    return this.service.runCommand(params);
  }

  /**
   * Development-only startup hook for exercising the real Electron lifecycle.
   *
   * Triggering workflow:
   *
   * `App.runControllerHooks('afterFirstFrame')`
   *   -> `AUV_AUTO_CONNECT=1`
   *     -> {@link AuvCtr.afterFirstFrame}
   *
   * Upstream:
   * - Electron's first visible renderer frame
   *
   * Downstream:
   * - {@link AuvService.connect}
   */
  async afterFirstFrame() {
    if (process.env.AUV_AUTO_CONNECT !== '1') return;

    try {
      await this.service.connect();
    } catch (error) {
      logger.error('AUV auto-connect failed:', error);
    }
  }
}
