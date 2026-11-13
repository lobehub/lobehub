'use client';

import {
  Button,
  createModal,
  Flexbox,
  Input,
  ModalFooter,
  Text,
  TextArea,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { t as translate } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDashboardStore } from '@/store/dashboard';

/** Longest widget title and metric definition the API accepts. */
const TITLE_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 2000;

interface WidgetEditFormProps {
  widget: { description?: string | null; id: string; title: string };
}

/** A widget's own name and metric definition (口径), saved on their own. */
const WidgetEditForm = ({ widget }: WidgetEditFormProps) => {
  const { t } = useTranslation(['dashboard', 'common']);
  const { close } = useModalContext();
  const updateWidget = useDashboardStore((s) => s.updateWidget);
  const [title, setTitle] = useState(widget.title);
  const [description, setDescription] = useState(widget.description ?? '');
  const [saving, setSaving] = useState(false);
  const trimmedTitle = title.trim();

  const handleSave = async () => {
    if (!trimmedTitle || saving) return;
    const nextDescription = description.trim() || null;
    const patch = {
      ...(trimmedTitle !== widget.title ? { title: trimmedTitle } : {}),
      ...(nextDescription !== (widget.description ?? null) ? { description: nextDescription } : {}),
    };
    if (Object.keys(patch).length === 0) {
      close();
      return;
    }
    setSaving(true);
    try {
      await updateWidget(widget.id, patch);
      toast.success(t('widgetEdit.saved'));
      close();
    } catch (error) {
      console.error('[dashboard] widget edit failed', error);
      toast.error(t('operationFailed', { ns: 'common' }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Flexbox gap={16} padding={16}>
        <Flexbox gap={6}>
          <Text fontSize={13} weight={500}>
            {t('widgetEdit.titleLabel')}
          </Text>
          <Input
            autoFocus
            data-widget-edit-title
            maxLength={TITLE_MAX_LENGTH}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onPressEnter={() => void handleSave()}
          />
        </Flexbox>
        <Flexbox gap={6}>
          <Text fontSize={13} weight={500}>
            {t('chat.definition')}
          </Text>
          <TextArea
            data-widget-edit-description
            autoSize={{ maxRows: 6, minRows: 2 }}
            maxLength={DESCRIPTION_MAX_LENGTH}
            placeholder={t('widgetEdit.descriptionPlaceholder')}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Flexbox>
      </Flexbox>
      <ModalFooter>
        <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
        <Button
          data-widget-edit-save
          disabled={!trimmedTitle}
          loading={saving}
          type={'primary'}
          onClick={() => void handleSave()}
        >
          {t('save', { ns: 'common' })}
        </Button>
      </ModalFooter>
    </>
  );
};

export const openWidgetEditModal = (widget: WidgetEditFormProps['widget']) =>
  createModal({
    content: <WidgetEditForm widget={widget} />,
    footer: null,
    styles: { content: { padding: 0 } },
    title: translate('widgetEdit.title', { ns: 'dashboard' }),
    width: 460,
  });
