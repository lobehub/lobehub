import type { ChatTopic } from '@lobechat/types';
import { t } from 'i18next';

import { projectWorkingDirectoryService } from '@/services/projectWorkingDirectory';

/**
 * UI preflight for a project-directory conversation, run before the composer is
 * cleared so a rejected send keeps the user's text and uploads.
 *
 * Resolves the binding (DB only) so a directory that was deleted, unlinked or
 * made read-only while the conversation was open still rejects up front. It
 * deliberately does NOT probe the device with `deviceService.statPath`: that
 * round trip sat in front of every send — up to its 8s timeout — and rejected
 * the message when the device was merely slow to answer. Whether the directory
 * still exists on the device is discovered by the dispatch that follows, which
 * is the single source of truth for liveness; the runtime revalidates the
 * binding before every execution.
 */
export async function checkProjectExecution(topic: ChatTopic | undefined, gatewayEnabled: boolean) {
  if (!topic?.projectWorkingDirectoryId) return;
  if (!gatewayEnabled) throw new Error(t('topics.gatewayUnavailable', { ns: 'project' }));
  // Throws for a missing, disabled or read-only directory.
  await projectWorkingDirectoryService.resolve(topic.projectWorkingDirectoryId);
}
