import type { MessagePatchData } from '@lobechat/agent-gateway-client';
import { projectToolViewModels } from '@lobechat/tool-view-model';
import type { UIChatMessage } from '@lobechat/types';
import isEqual from 'fast-deep-equal';

/**
 * Diff two canonical top-level message lists for one native runtime step.
 * Nested compression/member structures remain atomic: if a nested row changes,
 * its top-level envelope is upserted as one unit so the client never has to
 * reproduce server-side conversation-flow grouping rules.
 */
export const buildMessagePatch = (
  before: UIChatMessage[],
  after: UIChatMessage[],
  revision: number,
): MessagePatchData => {
  const beforeById = new Map(before.map((message) => [message.id, message]));
  const afterIds = new Set(after.map((message) => message.id));

  return {
    deletes: before.filter((message) => !afterIds.has(message.id)).map((message) => message.id),
    revision,
    upserts: after.flatMap((message, index) => {
      const previous = beforeById.get(message.id);
      if (previous && isEqual(previous, message)) return [];

      return [
        {
          afterId: index === 0 ? null : after[index - 1].id,
          message,
        },
      ];
    }),
  };
};

/**
 * The wire form of {@link buildMessagePatch}: both sides reduced to tool view
 * models before diffing.
 *
 * A patch only ever goes to a client that asked for protocol 2, and that client
 * reads its conversation through the projected `message.getMessages` too — so an
 * unprojected upsert would both put the bodies the projection exists to keep off
 * the socket back on it, and replace the client's projected cache copy with a
 * shape the rest of its list does not have. Projecting AFTER the diff would not
 * do: `isEqual` has to compare like for like, or a row whose only change was
 * projected away still ships.
 */
export const buildProjectedMessagePatch = (
  before: UIChatMessage[],
  after: UIChatMessage[],
  revision: number,
): MessagePatchData =>
  buildMessagePatch(projectToolViewModels(before), projectToolViewModels(after), revision);

/**
 * Swap each upserted `compressedGroup` envelope for its copy in `withMembers`,
 * projected like the rest of the patch.
 *
 * A protocol-2 run reads the topic without compression-group members (see
 * `queryStepEntryMessages`), so both sides of the diff carry member-less envelopes
 * and an untouched group never ships. A group the step created or changed
 * does ship, and the client replaces its copy with whatever the patch holds:
 * sent as read, the group would lose the original messages the client shows
 * when it is expanded. Undefined when `withMembers` lacks one of them.
 */
export const fillCompressedGroupUpserts = (
  patch: MessagePatchData,
  withMembers: UIChatMessage[],
): MessagePatchData | undefined => {
  const byId = new Map(withMembers.map((message) => [message.id, message]));
  const upserts: MessagePatchData['upserts'] = [];

  for (const upsert of patch.upserts) {
    if (upsert.message.role !== 'compressedGroup') {
      upserts.push(upsert);
      continue;
    }

    const filled = byId.get(upsert.message.id);
    if (!filled) return undefined;
    upserts.push({ ...upsert, message: projectToolViewModels([filled])[0] });
  }

  return { ...patch, upserts };
};

/** Whether {@link fillCompressedGroupUpserts} has anything to fill. */
export const hasCompressedGroupUpsert = (patch: MessagePatchData): boolean =>
  patch.upserts.some((upsert) => upsert.message.role === 'compressedGroup');
