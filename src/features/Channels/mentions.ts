import type { ChannelMemberActorType } from '@lobechat/types';
import type { UnknownRecord } from '@lobechat/utils/object';
import { isRecord } from '@lobechat/utils/object';
import { $getSelection, $isRangeSelection, $isTextNode } from 'lexical';

/** The editor's @ matcher requires a whitespace boundary, even after Chinese prose. */
export function $insertChannelMentionBoundary(event: KeyboardEvent): boolean {
  if (event.key !== '@' || event.isComposing) return false;
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.hasFormat('code'))
    return false;
  const node = selection.anchor.getNode();
  if (!$isTextNode(node) || !node.isSimpleText() || node.hasFormat('code')) return false;
  // ReactCodePlugin wraps ordinary text in a codeInline element, without a code format flag.
  if (node.getParents().some((parent) => parent.getType() === 'codeInline')) return false;
  const before = node.getTextContent().slice(0, selection.anchor.offset);
  if (!/[\p{Script=Han}，。！？、；：“”‘’（）【】《》「」『』]$/u.test(before)) return false;
  selection.insertText(' @');
  return true;
}

/** Chip metadata for someone outside the Channel; choosing them invites them in. */
export interface ChannelMentionInvite {
  actorType: ChannelMemberActorType;
  /** The user id of a person, or the Agent id. */
  id: string;
  /** Shown when they cannot be added. */
  name: string;
  type: 'channel-invite';
}

/** Visits the metadata of every editor-created mention chip outside code. */
const visitMentionMetadata = (document: unknown, onMention: (metadata: UnknownRecord) => void) => {
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    const node = value;
    if (typeof node.type === 'string' && /code/i.test(node.type)) return;
    if (node.type === 'mention' && isRecord(node.metadata)) onMention(node.metadata);
    if (node.root) visit(node.root);
    if (node.children) visit(node.children);
  };
  visit(document);
};

/** Only editor-created member chips select recipients; plain text and code never do. */
export function channelMentionIds(document: unknown, memberIds: string[]): string[] {
  const allowed = new Set(memberIds);
  const result = new Set<string>();
  visitMentionMetadata(document, (metadata) => {
    if (
      metadata.type === 'channel-member' &&
      typeof metadata.id === 'string' &&
      allowed.has(metadata.id)
    )
      result.add(metadata.id);
  });
  return [...result];
}

/** People and Agents mentioned from outside the Channel, once each. */
export function channelMentionInvites(document: unknown): ChannelMentionInvite[] {
  const result = new Map<string, ChannelMentionInvite>();
  visitMentionMetadata(document, (metadata) => {
    if (
      metadata.type === 'channel-invite' &&
      (metadata.actorType === 'agent' || metadata.actorType === 'user') &&
      typeof metadata.id === 'string' &&
      metadata.id
    )
      result.set(`${metadata.actorType}:${metadata.id}`, {
        actorType: metadata.actorType,
        id: metadata.id,
        name: typeof metadata.name === 'string' ? metadata.name : '',
        type: 'channel-invite',
      });
  });
  return [...result.values()];
}
