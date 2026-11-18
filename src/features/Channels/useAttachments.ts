import { CHANNEL_LIMITS, type UploadFileItem } from '@lobechat/types';
import { COMPRESSIBLE_IMAGE_TYPES, compressImageFile } from '@lobechat/utils/compressImage';
import { toast } from '@lobehub/ui';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { FILE_UPLOAD_BLACKLIST } from '@/const/file';
import { useFileStore } from '@/store/file';

export type DraftFile = UploadFileItem & { fileId?: string };

/** An image is shown from the local file while it uploads; the URL lives as long as the draft. */
const localPreview = (file: File) =>
  file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
const releasePreview = (item: DraftFile) => {
  if (item.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
};

interface AttachmentDraft {
  items: DraftFile[];
  listeners: Set<() => void>;
  mounts: number;
}

/**
 * Attachments belong to the conversation a composer writes to, not to one mounted composer, so
 * a thread moving between the side panel and the page keeps its files and running uploads.
 */
const drafts = new Map<string, AttachmentDraft>();

const draftFor = (key: string) => {
  let draft = drafts.get(key);
  if (!draft) {
    draft = { items: [], listeners: new Set(), mounts: 0 };
    drafts.set(key, draft);
  }
  return draft;
};

/** Each Channel/Thread composer owns its uploads; ordinary chat's global draft is untouched. */
export function useAttachments(draftKey: string) {
  const { t } = useTranslation('channel');
  const upload = useFileStore((s) => s.uploadWithProgress);
  const draft = draftFor(draftKey);
  const subscribe = useCallback(
    (listener: () => void) => {
      draft.listeners.add(listener);
      return () => draft.listeners.delete(listener);
    },
    [draft],
  );
  const items = useSyncExternalStore(subscribe, () => draft.items);
  const update = (next: DraftFile[]) => {
    draft.items = next;
    for (const listener of draft.listeners) listener();
  };
  const patch = (id: string, value: Partial<DraftFile>) =>
    update(draft.items.map((item) => (item.id === id ? { ...item, ...value, id } : item)));

  useEffect(() => {
    // A composer shown again after its draft was released starts it afresh.
    if (!drafts.has(draftKey)) drafts.set(draftKey, draft);
    draft.mounts += 1;
    return () => {
      draft.mounts -= 1;
      // Wait a tick: the composer taking over this conversation mounts in the same commit.
      setTimeout(() => {
        if (draft.mounts > 0 || drafts.get(draftKey) !== draft) return;
        drafts.delete(draftKey);
        for (const item of draft.items) {
          item.abortController?.abort();
          releasePreview(item);
        }
        update([]);
      });
    };
  }, [draft, draftKey]);

  const run = async (item: DraftFile) => {
    const abortController = new AbortController();
    patch(item.id, { abortController, error: undefined, errorCode: undefined, status: 'pending' });
    try {
      const file = COMPRESSIBLE_IMAGE_TYPES.has(item.file.type)
        ? await compressImageFile(item.file)
        : item.file;
      if (abortController.signal.aborted) return;
      const result = await upload({
        file,
        abortController,
        uploadId: item.id,
        onStatusUpdate: (event) => {
          if (abortController.signal.aborted) return;
          if (event.type === 'updateFile') patch(item.id, event.value);
        },
      });
      if (abortController.signal.aborted) return;
      if (!result) {
        patch(item.id, { status: 'error', error: t('attachments.failed') });
        return;
      }
      patch(item.id, { fileId: result.id, fileUrl: result.url, status: 'success' });
    } catch (cause) {
      console.error('Failed to upload Channel attachment', cause);
      if (!abortController.signal.aborted)
        patch(item.id, { status: 'error', error: t('attachments.failed') });
    }
  };

  return {
    items,
    blocked: items.some((item) => item.status !== 'success'),
    // Read synchronously so Enter cannot race a just-started upload before React renders.
    readyFileIds: () =>
      draft.items.every((item) => item.status === 'success' && item.fileId)
        ? draft.items.map((item) => item.fileId!)
        : undefined,
    upload: async (files: File[]) => {
      const accepted = files.filter((file) => !FILE_UPLOAD_BLACKLIST.includes(file.name));
      if (draft.items.length + accepted.length > CHANNEL_LIMITS.attachments) {
        toast.error(t('attachments.limit', { count: CHANNEL_LIMITS.attachments }));
        return;
      }
      const added = accepted.map((file): DraftFile => ({
        file,
        id: crypto.randomUUID(),
        previewUrl: localPreview(file),
        status: 'pending',
      }));
      update([...draft.items, ...added]);
      await Promise.all(added.map(run));
    },
    remove: (id: string) => {
      const removed = draft.items.find((item) => item.id === id);
      removed?.abortController?.abort();
      if (removed) releasePreview(removed);
      update(draft.items.filter((item) => item.id !== id));
    },
    retry: (id: string) => {
      const item = draft.items.find((item) => item.id === id);
      if (item?.status === 'error') void run(item);
    },
    // A sent draft's images are shown from their uploaded URLs; the local copies can go.
    clear: () => {
      for (const item of draft.items) releasePreview(item);
      update([]);
    },
  };
}
