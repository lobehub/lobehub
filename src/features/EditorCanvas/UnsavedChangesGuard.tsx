'use client';

import { toast } from '@lobehub/ui/base-ui';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useBlocker } from 'react-router';

interface UnsavedChangesGuardProps {
  isDirty: boolean;
  message: string;
  onAutoSave?: () => Promise<boolean>;
  title?: string;
}

const UnsavedChangesGuard = memo<UnsavedChangesGuardProps>(
  ({ isDirty, message, onAutoSave, title: _title }) => {
    void _title;
    const { t } = useTranslation('file');

    const blocker = useBlocker(isDirty);

    const blockerRef = useRef(blocker);
    const isSavingRef = useRef(false);
    blockerRef.current = blocker;

    useEffect(() => {
      if (blocker.state !== 'blocked') return;
      if (isSavingRef.current) return;

      isSavingRef.current = true;
      const leaveWithAutoSave = async () => {
        const savingToast = toast.loading(t('pageEditor.saving'));

        try {
          const saved = (await onAutoSave?.()) ?? true;

          if (!saved) {
            savingToast.close();
            toast.error({
              description: t('pageEditor.saveFailed'),
              duration: 2000,
            });
            blockerRef.current?.reset?.();
            return;
          }

          savingToast.close();
          blockerRef.current?.proceed?.();
        } catch (error) {
          const content =
            error instanceof Error && error.message ? error.message : t('pageEditor.saveFailed');

          savingToast.close();
          toast.error({
            description: content,
            duration: 2000,
          });
          blockerRef.current?.reset?.();
        } finally {
          isSavingRef.current = false;
        }
      };

      void leaveWithAutoSave();
    }, [blocker.state, message, onAutoSave, t]);

    useEffect(() => {
      if (!isDirty) return;

      const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        e.preventDefault();
        e.returnValue = message;
      };

      window.addEventListener('beforeunload', handleBeforeUnload);

      return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
      };
    }, [isDirty, message]);

    return null;
  },
);

UnsavedChangesGuard.displayName = 'UnsavedChangesGuard';

export default UnsavedChangesGuard;
