'use client';

import { Button, Flexbox, Input, Text } from '@lobehub/ui';
import { createModal, type ModalInstance, useModalContext } from '@lobehub/ui/base-ui';
import { type InputRef } from 'antd';
import { t } from 'i18next';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface RenameModalContentProps {
  defaultValue: string;
  description?: string;
  onSave: (newTitle: string) => void | Promise<void>;
}

const RenameModalContent = memo<RenameModalContentProps>(
  ({ defaultValue, description, onSave }) => {
    const { t: tCommon } = useTranslation('common');
    const { close } = useModalContext();
    const [value, setValue] = useState(defaultValue);
    const [loading, setLoading] = useState(false);
    const inputRef = useRef<InputRef>(null);

    useEffect(() => {
      queueMicrotask(() => {
        inputRef.current?.focus({ cursor: 'all' });
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
  onSave: (newTitle: string) => void | Promise<void>;
  title?: string;
}

export const openRenameModal = ({
  defaultValue,
  description,
  onSave,
  title,
}: OpenRenameModalProps): ModalInstance =>
  createModal({
    content: (
      <RenameModalContent defaultValue={defaultValue} description={description} onSave={onSave} />
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
