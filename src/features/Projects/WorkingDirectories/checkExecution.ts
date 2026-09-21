import type { ChatTopic } from '@lobechat/types';
import { t } from 'i18next';

import { deviceService } from '@/services/device';
import { projectWorkingDirectoryService } from '@/services/projectWorkingDirectory';

/** UI preflight only; the runtime revalidates the binding before every execution. */
export async function checkProjectExecution(topic: ChatTopic | undefined, gatewayEnabled: boolean) {
  if (!topic?.projectWorkingDirectoryId) return;
  if (!gatewayEnabled) throw new Error(t('topics.gatewayUnavailable', { ns: 'project' }));
  const { data: directory } = await projectWorkingDirectoryService.resolve(
    topic.projectWorkingDirectoryId,
  );
  const stat = await deviceService.statPath(directory.deviceId, directory.path);
  if (!stat?.exists || !stat.isDirectory)
    throw new Error(t('settings.directoryUnavailable', { ns: 'project' }));
}
