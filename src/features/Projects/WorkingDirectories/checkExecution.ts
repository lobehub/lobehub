import type { ChatTopic } from '@lobechat/types';
import { t } from 'i18next';

/**
 * UI preflight for a project-directory conversation.
 *
 * Only the gateway precondition is checked here — it reads local state, so it
 * costs no round trip. Whether the directory still exists on the device is
 * discovered by the dispatch that follows, which is the single source of truth
 * for liveness. Probing it here with `deviceService.statPath` put a full device
 * round trip (up to its 8s timeout) in front of every send and rejected the
 * message when the device was merely slow to answer.
 *
 * The runtime revalidates the binding before every execution.
 */
export function checkProjectExecution(topic: ChatTopic | undefined, gatewayEnabled: boolean) {
  if (!topic?.projectWorkingDirectoryId) return;
  if (!gatewayEnabled) throw new Error(t('topics.gatewayUnavailable', { ns: 'project' }));
}
