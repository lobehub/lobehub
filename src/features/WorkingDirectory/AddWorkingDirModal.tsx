'use client';

import { Flexbox, Input, Text } from '@lobehub/ui';
import { Button, createModal, type ModalInstance, useModalContext } from '@lobehub/ui/base-ui';
import { type InputRef } from 'antd';
import { cssVar } from 'antd-style';
import { t } from 'i18next';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface AddWorkingDirContentProps {
  /**
   * Submit the entered path. Return an error message to show inline and keep the
   * modal open; return undefined on success (the modal closes). Lets the caller
   * validate (e.g. statPath) and enrich (repoType) in one round-trip.
   */
  onSubmit: (path: string) => Promise<string | undefined>;
  placeholder?: string;
}

const AddWorkingDirContent = memo<AddWorkingDirContentProps>(({ onSubmit, placeholder }) => {
  const { t: tPlugin } = useTranslation('device');
  const { t: tCommon } = useTranslation('common');
  const { close } = useModalContext();
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const inputRef = useRef<InputRef>(null);

  useEffect(() => {
    queueMicrotask(() => inputRef.current?.focus());
  }, []);

  const handleSubmit = useCallback(async () => {
    if (loading) return;
    const next = value.trim();
    if (!next) {
      close();
      return;
    }
    setLoading(true);
    try {
      const message = await onSubmit(next);
      if (message) {
        setError(message);
        return;
      }
      close();
    } finally {
      setLoading(false);
    }
  }, [close, loading, onSubmit, value]);

  return (
    <Flexbox gap={16}>
      <Text style={{ marginTop: -8 }} type={'secondary'}>
        {tPlugin('workingDirectory.addFolderDesc')}
      </Text>
      <Flexbox gap={6}>
        <Input
          placeholder={placeholder || tPlugin('workingDirectory.placeholder')}
          ref={inputRef}
          value={value}
          onPressEnter={handleSubmit}
          onChange={(e) => {
            setValue(e.target.value);
            setError(undefined);
          }}
        />
        {error ? <Text style={{ color: cssVar.colorError, fontSize: 12 }}>{error}</Text> : null}
      </Flexbox>
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button disabled={loading} onClick={close}>
          {tCommon('cancel')}
        </Button>
        <Button loading={loading} type={'primary'} onClick={handleSubmit}>
          {tCommon('confirm')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

AddWorkingDirContent.displayName = 'AddWorkingDirContent';

/**
 * Manual absolute-path entry for the working directory. Used when the target
 * filesystem isn't browsable from here (web, or a remote device) — the browser
 * has no way to resolve an absolute path from its sandboxed folder picker.
 */
export const openAddWorkingDirModal = (options: {
  onSubmit: (path: string) => Promise<string | undefined>;
  placeholder?: string;
}): ModalInstance =>
  createModal({
    content: <AddWorkingDirContent placeholder={options.placeholder} onSubmit={options.onSubmit} />,
    footer: null,
    maskClosable: true,
    styles: { header: { borderBottom: 'none' } },
    title: t('workingDirectory.addFolderTitle', { ns: 'device' }),
    width: 'min(90vw, 480px)',
  });
