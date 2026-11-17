'use client';

import {
  Button,
  createModal,
  cssVar,
  Flexbox,
  Input,
  type ModalInstance,
  Text,
  useModalContext,
} from '@lobehub/ui';
import { t } from 'i18next';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Longest name the server accepts. */
const NAME_MAX = 100;

interface RenameContentProps {
  currentName: string;
  /** What an empty name falls back to (the event, or a webhook's default name); the placeholder. */
  fallback: string;
  /** Save the name (null clears it). Return an error to show inline and keep the dialog open. */
  onSubmit: (name: string | null) => Promise<string | undefined>;
}

const RenameContent = memo<RenameContentProps>(({ currentName, fallback, onSubmit }) => {
  const { t } = useTranslation(['setting', 'common']);
  const { close } = useModalContext();
  const [value, setValue] = useState(currentName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    queueMicrotask(() => inputRef.current?.select());
  }, []);

  const trimmed = value.trim();
  const unchanged = trimmed === currentName.trim();

  const submit = useCallback(async () => {
    if (loading || unchanged) return;
    setLoading(true);
    try {
      const message = await onSubmit(trimmed || null);
      if (message) {
        setError(message);
        return;
      }
      close();
    } finally {
      setLoading(false);
    }
  }, [close, loading, onSubmit, trimmed, unchanged]);

  return (
    <Flexbox gap={16}>
      <Flexbox gap={6}>
        <Input
          maxLength={NAME_MAX}
          placeholder={fallback}
          ref={inputRef}
          value={value}
          onPressEnter={submit}
          onChange={(event) => {
            setValue(event.target.value);
            setError(undefined);
          }}
        />
        <Text style={{ fontSize: 12 }} type={'secondary'}>
          {t('automations.rename.hint', { fallback })}
        </Text>
        {error ? <Text style={{ color: cssVar.colorError, fontSize: 12 }}>{error}</Text> : null}
      </Flexbox>
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button disabled={loading} onClick={close}>
          {t('cancel', { ns: 'common' })}
        </Button>
        <Button disabled={unchanged} loading={loading} type={'primary'} onClick={submit}>
          {t('automations.rename.ok')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

RenameContent.displayName = 'AutomationRenameContent';

/**
 * The name people see for an automation or a webhook; clearing it shows the fallback again. What
 * the agent knows it by (its event, or a webhook's identifier) never changes here.
 */
export const openRenameAutomationModal = ({
  title,
  ...options
}: RenameContentProps & { title?: string }): ModalInstance =>
  createModal({
    content: <RenameContent {...options} />,
    footer: null,
    maskClosable: true,
    styles: { header: { borderBottom: 'none' } },
    title: title ?? t('automations.rename.title', { ns: 'setting' }),
    width: 'min(90vw, 480px)',
  });
