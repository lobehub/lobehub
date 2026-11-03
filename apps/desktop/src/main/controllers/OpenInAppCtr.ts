import type {
  DetectAppsResult,
  OpenInAppParams,
  OpenInAppResult,
} from '@lobechat/electron-client-ipc';

import { getCachedDetection } from '@/modules/openInApp/cache';
import { detectApp } from '@/modules/openInApp/detectors';
import { launchApp } from '@/modules/openInApp/launchers';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:OpenInAppCtr');

export default class OpenInAppCtr extends ControllerModule {
  static override readonly groupName = 'openInApp';

  @IpcMethod()
  async detectApps(): Promise<DetectAppsResult> {
    const apps = await getCachedDetection();
    return { apps };
  }

  @IpcMethod()
  async openInApp({ appId, path }: OpenInAppParams): Promise<OpenInAppResult> {
    // Re-validate installation status before launching: per spec, the main
    // process must reject if the app disappeared between probe and launch.
    const installed = await detectApp(appId, process.platform);
    if (!installed) {
      logger.warn(`openInApp: ${appId} reported not installed`);
      return { error: `${appId} is not installed`, success: false };
    }

    const result = await launchApp(appId, path, process.platform);
    if (result.success) {
      logger.info(`openInApp: launched ${appId} with path ${path}`);
    } else {
      logger.error(`openInApp: launch failed for ${appId}: ${result.error}`);
    }
    return result;
  }
}
