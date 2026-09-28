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
  const baseContentRef = useRef(content);
  const pendingSaveRef = useRef<Promise<void> | undefined>(undefined);
  const tRef = useRef(t);
  bufferRef.current = buffer;
  documentIdRef.current = documentId;
  onSavedRef.current = onSaved;
  tRef.current = t;

  const saveBuffer = useCallback(async (source: 'manual' | 'autosave') => {
    const toWrite = bufferRef.current;
    if (toWrite === undefined) return;
    const expectedUpdatedAt = expectedUpdatedAtRef.current;
    try {
      const result = await documentService.updateDocument({
        content: toWrite,
        id: documentIdRef.current,
        saveSource: source,
        ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
      });
      if (result?.updatedAt) {
        const savedAt = new Date(result.updatedAt);
        if (expectedUpdatedAtRef.current && savedAt < expectedUpdatedAtRef.current) return;
        expectedUpdatedAtRef.current = savedAt;
      }
      baseContentRef.current = toWrite;
      onSavedRef.current(toWrite, result?.updatedAt);
      if (bufferRef.current === toWrite) {
        bufferRef.current = undefined;
        setBuffer(undefined);
      }
    } catch (error) {
      if (isConflictError(error)) {
        // A newer remote row already reconciled this request's base.
        if (expectedUpdatedAtRef.current?.getTime() !== expectedUpdatedAt?.getTime()) return;
        bufferRef.current = undefined;
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

  const writeBuffer = useCallback(
    (source: 'manual' | 'autosave') => {
      const run = (pendingSaveRef.current ?? Promise.resolve()).then(() => saveBuffer(source));
      pendingSaveRef.current = run;
      return run;
    },
    [saveBuffer],
  );

  const debouncedAutoSave = useMemo(
    () =>
      debounce(() => writeBuffer('autosave'), EDITOR_DEBOUNCE_TIME, {
        leading: false,
        maxWait: EDITOR_MAX_WAIT,
        trailing: true,
      }),
    [writeBuffer],
  );

  useEffect(() => {
    const knownVersion = expectedUpdatedAtRef.current;
    if (!updatedAt || (knownVersion && updatedAt <= knownVersion)) return;
    if (content !== baseContentRef.current) {
      debouncedAutoSave.cancel();
      bufferRef.current = undefined;
      setBuffer(undefined);
    }
    baseContentRef.current = content;
    expectedUpdatedAtRef.current = updatedAt;
  }, [content, updatedAt, debouncedAutoSave]);

  const handleChange = useCallback(
    (next: string) => {
      const isDirty = next !== baseContentRef.current;
      bufferRef.current = isDirty ? next : undefined;
      setBuffer(bufferRef.current);
      if (isDirty) debouncedAutoSave();
      else debouncedAutoSave.cancel();
    },
    [debouncedAutoSave],
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
      // Defer the fire-and-forget save to a microtask so that StrictMode's synchronous
      // unmount/remount in development does not trigger a save. If the component is
      // immediately remounted, isMountedRef flips back to true before this runs.
      queueMicrotask(() => {
        if (isMountedRef.current) return;
        void writeBuffer('autosave');
      });
    };
  }, [debouncedAutoSave, writeBuffer]);

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
