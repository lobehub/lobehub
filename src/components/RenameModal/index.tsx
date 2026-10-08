'use client';

import { Flexbox } from '@lobehub/ui';
import {
  Button,
  createModal,
  Input,
  type ModalInstance,
  Text,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface RenameModalContentProps {
  defaultValue: string;
  description?: string;
  maxLength?: number;
  onSave: (newTitle: string) => void | Promise<void>;
}

const RenameModalContent = memo<RenameModalContentProps>(
  ({ defaultValue, description, maxLength, onSave }) => {
    const { t: tCommon } = useTranslation('common');
    const { close } = useModalContext();
    const [value, setValue] = useState(defaultValue);
    const [loading, setLoading] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      queueMicrotask(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }, []);

    const handleSave = useCallback(async () => {
      if (loading) return;
      const next = value.trim();
      if (!next || next === defaultValue) {
        close();
        return;
      }
      setLoading(true);
      try {
        await onSave(next);
        close();
      } catch {
        // A rejected save keeps the dialog open so the typed title can be
        // retried; `onSave` owns reporting the failure.
      } finally {
        setLoading(false);
      }
    }, [close, defaultValue, loading, onSave, value]);

    return (
      <Flexbox gap={20}>
        {description ? (
          <Text style={{ marginTop: -8 }} type={'secondary'}>
            {description}
          </Text>
        ) : null}
        <Input
          autoFocus
          maxLength={maxLength}
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onPressEnter={handleSave}
        />
        <Flexbox horizontal gap={8} justify={'flex-end'}>
          <Button disabled={loading} onClick={close}>
            {tCommon('cancel')}
          </Button>
          <Button loading={loading} type={'primary'} onClick={handleSave}>
            {tCommon('save')}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

RenameModalContent.displayName = 'RenameModalContent';

export interface OpenRenameModalProps {
  defaultValue: string;
  description?: string;
  maxLength?: number;
  onSave: (newTitle: string) => void | Promise<void>;
  title?: string;
}

export const openRenameModal = ({
  defaultValue,
  description,
  maxLength,
  onSave,
  title,
}: OpenRenameModalProps): ModalInstance =>
  createModal({
    content: (
      <RenameModalContent
        defaultValue={defaultValue}
        description={description}
        maxLength={maxLength}
        onSave={onSave}
      />
    ),
    footer: null,
    maskClosable: true,
    styles: {
      header: { borderBottom: 'none' },
    },
    title: title ?? t('rename', { ns: 'common' }),
    width: 'min(90vw, 480px)',
  });

export default openRenameModal;
