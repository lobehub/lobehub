'use client';

import { Button, Flexbox, Input, Text } from '@lobehub/ui';
import { createModal, type ModalInstance, useModalContext } from '@lobehub/ui/base-ui';
import { type InputRef } from 'antd';
import { cssVar } from 'antd-style';
import { t } from 'i18next';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface CreateBranchContentProps {
  /**
   * Create + checkout the branch. Return an error message to show inline and
   * keep the modal open; return undefined on success (the modal closes).
   */
  onSubmit: (name: string) => Promise<string | undefined>;
}

const CreateBranchContent = memo<CreateBranchContentProps>(({ onSubmit }) => {
  const { t: tDevice } = useTranslation('device');
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
    const name = value.trim();
    if (!name) return;
    setLoading(true);
    try {
      const message = await onSubmit(name);
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
      <Flexbox gap={6}>
        <Input
          placeholder={tDevice('workingDirectory.newBranchPlaceholder')}
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
        <Button disabled={!value.trim()} loading={loading} type={'primary'} onClick={handleSubmit}>
          {tDevice('workingDirectory.checkoutAction')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

CreateBranchContent.displayName = 'CreateBranchContent';

/**
 * Branch-name entry for "checkout new branch". Replaces the inline dropdown
 * footer with a focused modal; submitting creates and checks out the branch.
 */
export const openCreateBranchModal = (options: {
  onSubmit: (name: string) => Promise<string | undefined>;
}): ModalInstance =>
  createModal({
    content: <CreateBranchContent onSubmit={options.onSubmit} />,
    footer: null,
    maskClosable: true,
    styles: { header: { borderBottom: 'none' } },
    title: t('workingDirectory.createBranchTitle', { ns: 'device' }),
    width: 'min(90vw, 480px)',
  });
