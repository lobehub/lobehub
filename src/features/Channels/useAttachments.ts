import { CHANNEL_LIMITS, type UploadFileItem } from '@lobechat/types';
import { COMPRESSIBLE_IMAGE_TYPES, compressImageFile } from '@lobechat/utils/compressImage';
import { toast } from '@lobehub/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FILE_UPLOAD_BLACKLIST } from '@/const/file';
import { useFileStore } from '@/store/file';

type DraftFile = UploadFileItem & { fileId?: string };

/** Each mounted Channel composer owns its uploads; ordinary chat's global draft is untouched. */
export function useAttachments() {
  const { t } = useTranslation('channel');
  const upload = useFileStore((s) => s.uploadWithProgress);
  const [items, setItems] = useState<DraftFile[]>([]);
  const current = useRef(items);
  const update = (next: DraftFile[]) => {
    current.current = next;
    setItems(next);
  };
  const patch = (id: string, value: Partial<DraftFile>) =>
    update(current.current.map((item) => (item.id === id ? { ...item, ...value, id } : item)));

  useEffect(
    () => () => {
      for (const item of current.current) item.abortController?.abort();
    },
    [],
  );

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
      current.current.every((item) => item.status === 'success' && item.fileId)
        ? current.current.map((item) => item.fileId!)
        : undefined,
    upload: async (files: File[]) => {
      const accepted = files.filter((file) => !FILE_UPLOAD_BLACKLIST.includes(file.name));
      if (current.current.length + accepted.length > CHANNEL_LIMITS.attachments) {
        toast.error(t('attachments.limit', { count: CHANNEL_LIMITS.attachments }));
        return;
      }
      const added = accepted.map((file): DraftFile => ({
        file,
        id: crypto.randomUUID(),
        status: 'pending',
      }));
      update([...current.current, ...added]);
      await Promise.all(added.map(run));
    },
    remove: (id: string) => {
      current.current.find((item) => item.id === id)?.abortController?.abort();
      update(current.current.filter((item) => item.id !== id));
    },
    retry: (id: string) => {
      const item = current.current.find((item) => item.id === id);
      if (item?.status === 'error') void run(item);
    },
    clear: () => update([]),
  };
}
