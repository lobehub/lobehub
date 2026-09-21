'use client';

import { EDITOR_DEBOUNCE_TIME, EDITOR_MAX_WAIT } from '@lobechat/const';
import { toast } from '@lobehub/ui/base-ui';
import { debounce } from 'es-toolkit/compat';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { mutate } from '@/libs/swr';
import { portalKeys } from '@/libs/swr/keys';
import { documentService } from '@/services/document';
import { invalidateDocumentMutation } from '@/services/document/invalidation';

const isConflictError = (error: unknown) =>
  (error as { data?: { code?: string } })?.data?.code === 'CONFLICT';

export interface UseHighlightSaveParams {
  content: string;
  documentId: string;
  onSaved: (content: string, updatedAt?: string) => void;
  updatedAt?: Date;
}

export interface UseHighlightSaveResult {
  editingValue: string;
  handleChange: (next: string) => void;
  handleSave: () => Promise<void>;
}

export const useHighlightSave = ({
  content,
  documentId,
  onSaved,
  updatedAt,
}: UseHighlightSaveParams): UseHighlightSaveResult => {
  const { t } = useTranslation('portal');
  const [buffer, setBuffer] = useState<string | undefined>(undefined);
  const editingValue = buffer ?? content;

  const bufferRef = useRef(buffer);
  const documentIdRef = useRef(documentId);
  const onSavedRef = useRef(onSaved);
  const expectedUpdatedAtRef = useRef(updatedAt);
  const tRef = useRef(t);
  bufferRef.current = buffer;
  documentIdRef.current = documentId;
  onSavedRef.current = onSaved;
  expectedUpdatedAtRef.current = updatedAt;
  tRef.current = t;

  const writeBuffer = useCallback(async (source: 'manual' | 'autosave') => {
    const toWrite = bufferRef.current;
    if (toWrite === undefined) return;
    try {
      const result = await documentService.updateDocument({
        content: toWrite,
        id: documentIdRef.current,
        saveSource: source,
        ...(expectedUpdatedAtRef.current
          ? { expectedUpdatedAt: expectedUpdatedAtRef.current }
          : {}),
      });
      onSavedRef.current(toWrite, result?.updatedAt);
      if (bufferRef.current === toWrite) setBuffer(undefined);
    } catch (error) {
      if (isConflictError(error)) {
        setBuffer(undefined);
        await Promise.allSettled([
          invalidateDocumentMutation({ documentId: documentIdRef.current }),
          mutate(portalKeys.documentHeader(documentIdRef.current)),
        ]);
        toast.error(tRef.current('document.saveConflict'));
        return;
      }
      console.error('[HighlightEditor] save failed:', error);
    }
  }, []);

  const debouncedAutoSave = useMemo(
    () =>
      debounce(() => writeBuffer('autosave'), EDITOR_DEBOUNCE_TIME, {
        leading: false,
        maxWait: EDITOR_MAX_WAIT,
        trailing: true,
      }),
    [writeBuffer],
  );

  const handleChange = useCallback(
    (next: string) => {
      const isDirty = next !== content;
      setBuffer(isDirty ? next : undefined);
      if (isDirty) debouncedAutoSave();
      else debouncedAutoSave.cancel();
    },
    [content, debouncedAutoSave],
  );

  const handleSave = useCallback(async () => {
    debouncedAutoSave.cancel();
    await writeBuffer('manual');
  }, [debouncedAutoSave, writeBuffer]);

  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      debouncedAutoSave.cancel();
      const pendingContent = bufferRef.current;
      if (pendingContent === undefined) return;
      const pendingDocumentId = documentIdRef.current;
      const pendingExpectedUpdatedAt = expectedUpdatedAtRef.current;
      // Defer the fire-and-forget save to a microtask so that StrictMode's synchronous
      // unmount/remount in development does not trigger a save. If the component is
      // immediately remounted, isMountedRef flips back to true before this runs.
      queueMicrotask(() => {
        if (isMountedRef.current) return;
        void documentService.updateDocument({
          content: pendingContent,
          id: pendingDocumentId,
          saveSource: 'autosave',
          ...(pendingExpectedUpdatedAt ? { expectedUpdatedAt: pendingExpectedUpdatedAt } : {}),
        });
      });
    };
  }, [debouncedAutoSave]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (bufferRef.current === undefined) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  return { editingValue, handleChange, handleSave };
};
