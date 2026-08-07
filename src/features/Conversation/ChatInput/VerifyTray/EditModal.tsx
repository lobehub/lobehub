'use client';

import { Flexbox, Input, Text, TextArea } from '@lobehub/ui';
import { Button, createModal, type ModalInstance, useModalContext } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { TrayCheck } from './types';

interface EditContentProps {
  /** Existing check to edit; undefined = authoring a new one. */
  initial?: TrayCheck;
  onRemove?: () => void;
  onSubmit: (value: { method: string; name: string }) => void | Promise<unknown>;
}

const EditContent = memo<EditContentProps>(({ initial, onRemove, onSubmit }) => {
  const { t: tv } = useTranslation('verify');
  const { close } = useModalContext();
  const [name, setName] = useState(initial?.name ?? '');
  const [method, setMethod] = useState(initial?.method ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      // Only close once the write lands; a failed save keeps the modal open.
      await onSubmit({ method: method.trim(), name: trimmed });
      close();
    } catch {
      // The caller already rolled back the optimistic value and toasted.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Flexbox gap={16}>
      <Flexbox gap={6}>
        <Text fontSize={12} type={'secondary'}>
          {tv('acceptance.tray.editModal.nameLabel')}
        </Text>
        <Input
          placeholder={tv('acceptance.tray.editModal.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Flexbox>

      <Flexbox gap={6}>
        <Text fontSize={12} type={'secondary'}>
          {tv('acceptance.tray.editModal.methodLabel')}
        </Text>
        <TextArea
          autoSize={{ maxRows: 4, minRows: 2 }}
          placeholder={tv('acceptance.tray.editModal.methodPlaceholder')}
          value={method}
          onChange={(e) => setMethod(e.target.value)}
        />
      </Flexbox>

      <Flexbox horizontal align={'center'} justify={'space-between'}>
        {onRemove ? (
          <Button
            danger
            type={'text'}
            onClick={() => {
              onRemove();
              close();
            }}
          >
            {tv('acceptance.tray.editModal.remove')}
          </Button>
        ) : (
          <span />
        )}
        <Flexbox horizontal gap={8}>
          <Button disabled={saving} onClick={close}>
            {tv('acceptance.actions.cancel')}
          </Button>
          <Button
            disabled={!name.trim() || saving}
            loading={saving}
            type={'primary'}
            onClick={handleSave}
          >
            {tv('acceptance.tray.editModal.save')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

EditContent.displayName = 'VerifyTrayEditContent';

export const openCheckEditModal = (options: EditContentProps): ModalInstance =>
  createModal({
    content: <EditContent {...options} />,
    footer: null,
    maskClosable: true,
    title: options.initial
      ? t('acceptance.tray.editModal.editTitle', { ns: 'verify' })
      : t('acceptance.tray.editModal.addTitle', { ns: 'verify' }),
    width: 'min(90vw, 520px)',
  });
