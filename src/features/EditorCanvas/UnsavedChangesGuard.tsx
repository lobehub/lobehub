'use client';

import { App } from 'antd';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useBlocker } from 'react-router-dom';

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
    const { message: messageApi } = App.useApp();
    const blocker = useBlocker(isDirty);

    const blockerRef = useRef(blocker);
    const isSavingRef = useRef(false);
    blockerRef.current = blocker;

    useEffect(() => {
      if (blocker.state !== 'blocked') return;
      if (isSavingRef.current) return;

      isSavingRef.current = true;
      const messageKey = `editor-leave-auto-save-${Date.now()}`;

      const leaveWithAutoSave = async () => {
        messageApi.loading({
          content: t('pageEditor.saving'),
          duration: 0,
          key: messageKey,
        });

        try {
          const saved = (await onAutoSave?.()) ?? true;

          if (!saved) {
            messageApi.error({
              content: t('networkError'),
              duration: 2,
              key: messageKey,
            });
            blockerRef.current?.reset?.();
            return;
          }

          messageApi.destroy(messageKey);
          blockerRef.current?.proceed?.();
        } catch (error) {
          const content =
            error instanceof Error && error.message ? error.message : t('networkError');

          messageApi.error({
            content,
            duration: 2,
            key: messageKey,
          });
          blockerRef.current?.reset?.();
        } finally {
          isSavingRef.current = false;
        }
      };

      void leaveWithAutoSave();
    }, [blocker.state, message, messageApi, onAutoSave, t]);

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
