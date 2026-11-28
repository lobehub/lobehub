import { isDesktop } from '@lobechat/const';

import { stagedProjectDirectoryIdSelector } from '@/features/ChatInput/ControlBar/useProjectTopicDirectory';
import { useChatStore } from '@/store/chat';
import { useElectronStore } from '@/store/electron';
import { useProjectDirectories, useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import type { ResolvedFilesLocation } from './useRememberedFilesLocation';

/**
 * The project directory a blank conversation was staged in. Its first message
 * runs there, not in the agent's own working directory, so the Files tree has
 * to show it. This desktop reads its own disk over IPC, so only another
 * device's directory carries a device id.
 */
export const useStagedFilesDirectory = (
  agentId: string | undefined,
  topicId: string | null | undefined,
): ResolvedFilesLocation | undefined => {
  const directoryId = useChatStore(stagedProjectDirectoryIdSelector(agentId, topicId));
  useProjectDirectoryStore((s) => s.useFetchDirectories)(undefined, !!directoryId);
  const directory = useProjectDirectories().find((d) => d.id === directoryId);
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);

  if (!directory?.path) return;

  const deviceId = directory.deviceId ?? undefined;
  const isThisDesktop = isDesktop && !!deviceId && deviceId === currentDeviceId;

  return { deviceId: isThisDesktop ? undefined : deviceId, directory: directory.path };
};
