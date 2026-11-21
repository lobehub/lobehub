export type MediaFileType = 'audio' | 'image' | 'video';

interface CreateMediaFileRefOptions {
  index: number;
  messageId?: string;
  type: MediaFileType;
}

export const createMediaLocalRef = (type: MediaFileType, index: number) => `${type}_${index + 1}`;

const hashMessageId = (messageId: string) => {
  let hash = 2166136261;

  for (const char of messageId) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36).slice(0, 6);
};

export const createMediaMessageRef = (messageId: string) => `msg_${hashMessageId(messageId)}`;

export const createMediaFileRef = ({ index, messageId, type }: CreateMediaFileRefOptions) => {
  const localRef = createMediaLocalRef(type, index);

  return messageId ? `${createMediaMessageRef(messageId)}.${localRef}` : localRef;
};
