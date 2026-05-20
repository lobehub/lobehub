export type VisualFileType = 'image' | 'video';

interface CreateVisualFileRefOptions {
  index: number;
  messageId?: string;
  type: VisualFileType;
}

export const createVisualLocalRef = (type: VisualFileType, index: number) => `${type}_${index + 1}`;

const hashMessageId = (messageId: string) => {
  let hash = 2166136261;

  for (const char of messageId) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36).slice(0, 6);
};

export const createVisualMessageRef = (messageId: string) => `msg_${hashMessageId(messageId)}`;

export const createVisualFileRef = ({ index, messageId, type }: CreateVisualFileRefOptions) => {
  const localRef = createVisualLocalRef(type, index);

  return messageId ? `${createVisualMessageRef(messageId)}.${localRef}` : localRef;
};
