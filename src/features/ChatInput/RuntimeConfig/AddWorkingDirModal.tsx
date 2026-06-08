'use client';

import { Button, Flexbox, Input, Text } from '@lobehub/ui';
import { createModal, type ModalInstance, useModalContext } from '@lobehub/ui/base-ui';
import { type InputRef } from 'antd';
import { t } from 'i18next';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface AddWorkingDirContentProps {
  onSubmit: (path: string) => void | Promise<void>;
  placeholder?: string;
}

const AddWorkingDirContent = memo<AddWorkingDirContentProps>(({ onSubmit, placeholder }) => {
  const { t: tPlugin } = useTranslation('plugin');
  const { t: tCommon } = useTranslation('common');
  const { close } = useModalContext();
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
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
      await onSubmit(next);
      close();
    } finally {
      setLoading(false);
    }
  }, [close, loading, onSubmit, value]);

  return (
    <Flexbox gap={16}>
      <Text style={{ marginTop: -8 }} type={'secondary'}>
        {tPlugin('localSystem.workingDirectory.addFolderDesc')}
      </Text>
      <Input
        placeholder={placeholder || tPlugin('localSystem.workingDirectory.placeholder')}
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onPressEnter={handleSubmit}
      />
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
export const openAddWorkingDirModal = (
  onSubmit: (path: string) => void | Promise<void>,
  placeholder?: string,
): ModalInstance =>
  createModal({
    content: <AddWorkingDirContent placeholder={placeholder} onSubmit={onSubmit} />,
    footer: null,
    maskClosable: true,
    styles: { header: { borderBottom: 'none' } },
    title: t('localSystem.workingDirectory.addFolderTitle', { ns: 'plugin' }),
    width: 'min(90vw, 480px)',
  });
