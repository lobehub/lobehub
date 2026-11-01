import type { ChatTopic } from '@lobechat/types';
import { t } from 'i18next';

import { projectWorkingDirectoryService } from '@/services/projectWorkingDirectory';
import { findProjectDirectory } from '@/store/projectWorkingDirectory';

/**
 * UI preflight for a project-directory conversation, run before the composer is
 * cleared so a rejected send keeps the user's text and uploads.
 *
 * Checks the binding so a directory that was deleted, unlinked or made
 * read-only while the conversation was open still rejects up front. A usable
 * row in the sidebar's directory replica passes without a network round trip —
 * a resolve here sat in front of every send. The replica only ever lets a send
 * through: it can lag a change (linking an environment refreshes environments,
 * not directories), so a missing or negative cached row asks the server, which
 * throws for a missing, disabled or read-only directory. The runtime still
 * revalidates the full binding before every execution, and a rejected dispatch
 * restores the composer itself. It deliberately does NOT probe the device with
 * `deviceService.statPath`: whether the directory still exists on the device
 * is discovered by the dispatch that follows.
 */
export async function checkProjectExecution(topic: ChatTopic | undefined, gatewayEnabled: boolean) {
  if (!topic?.projectWorkingDirectoryId) return;
  if (!gatewayEnabled) throw new Error(t('topics.gatewayUnavailable', { ns: 'project' }));

  const directory = findProjectDirectory(topic.projectWorkingDirectoryId);
  if (directory?.instanceId && directory.environmentId && directory.permission === 'readWrite')
    return;
  await projectWorkingDirectoryService.resolve(topic.projectWorkingDirectoryId);
}
