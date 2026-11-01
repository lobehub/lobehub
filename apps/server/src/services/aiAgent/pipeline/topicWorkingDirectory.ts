import { getWorkingDirEffectivePath } from '@lobechat/types';
import debug from 'debug';

import type { TopicModel } from '@/database/models/topic';

import type { BindTopicWorkingDirectoryParams } from '../types';

const log = debug('lobe-server:ai-agent-service');

export interface TopicWorkingDirectoryDeps {
  topicModel: TopicModel;
}

const stampTopicDevice = async (
  deps: TopicWorkingDirectoryDeps,
  topicId: string,
  deviceId: string,
): Promise<void> => {
  try {
    const topic = await deps.topicModel.findById(topicId);
    if (!topic || topic.metadata?.boundDeviceId) return;
    await deps.topicModel.updateMetadata(topicId, { boundDeviceId: deviceId });
  } catch (err) {
    log('execAgent: stampTopicDevice failed (non-fatal): %O', err);
  }
};

/**
 * Pin a topic to the directory its run actually executes in.
 *
 * A topic created by a device-bound run starts with no cwd of its own: the
 * directory was only ever recorded at agent level
 * (`agencyConfig.workingDirByDevice`) or on the device (`defaultCwd`). Without
 * this write the topic stays unbound — By-Project grouping files it under "No
 * directory", and every later turn re-resolves from the agent config, so
 * changing the agent's directory silently moves an old conversation to a new
 * project (and makes hetero `--resume` unsafe).
 *
 * Shared by BOTH execution paths — hetero device dispatch and the normal
 * agent runtime — so a native agent bound to a device gets the same binding a
 * CLI agent does. Purely additive: a topic that already carries a cwd (the
 * client resolved one and sent it as `initialTopicMetadata`, or an earlier
 * turn bound it) is never rewritten, so the historical pin always wins.
 *
 * The pin is a bare path that only holds on the machine it came from, so the
 * device is stamped alongside it (`boundDeviceId`, unless the topic already
 * names one) — that is what lets another device skip it. A topic already
 * bound to a different device is left unpinned rather than given this
 * device's path.
 *
 * An unbound topic that already carries a cwd (the client's initial
 * metadata, or a pre-binding row) still gets the device stamped: the run
 * just used that cwd here, and the binding is what keeps later turns and the
 * device picker on this machine.
 */
export const bindTopicWorkingDirectory = async (
  deps: TopicWorkingDirectoryDeps,
  params: BindTopicWorkingDirectoryParams,
): Promise<void> => {
  const { config, currentDeviceId, currentWorkingDirectory, deviceId, topicId } = params;
  if (!config) {
    // No directory resolved on this machine (no agent pick, no device
    // default), so the caller never read the topic either. The run still
    // happened here — pin an unbound topic to it all the same.
    if (deviceId) await stampTopicDevice(deps, topicId, deviceId);
    return;
  }
  if (currentDeviceId && deviceId && currentDeviceId !== deviceId) return;
  const stampDevice = !!deviceId && !currentDeviceId;
  const path = currentWorkingDirectory ? undefined : getWorkingDirEffectivePath(config);
  if (!path && !stampDevice) return;

  try {
    await deps.topicModel.updateMetadata(topicId, {
      ...(stampDevice && { boundDeviceId: deviceId }),
      ...(path && { workingDirectory: path, workingDirectoryConfig: config }),
    });
  } catch (err) {
    // Metadata bookkeeping must never fail a run that is otherwise fine.
    log('execAgent: bindTopicWorkingDirectory failed (non-fatal): %O', err);
  }
};
