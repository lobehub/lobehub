'use client';

import { Button, Flexbox, Input, Text } from '@lobehub/ui';
import { createModal, type ModalInstance, useModalContext } from '@lobehub/ui/base-ui';
import { type InputRef } from 'antd';
import { cssVar } from 'antd-style';
import { t } from 'i18next';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface RenameBranchContentProps {
  /** The branch's current name — prefilled and selected for quick editing. */
  currentName: string;
  /**
   * Rename the branch. Return an error message to show inline and keep the
   * modal open; return undefined on success (the modal closes).
   */
  onSubmit: (name: string) => Promise<string | undefined>;
}

const RenameBranchContent = memo<RenameBranchContentProps>(({ currentName, onSubmit }) => {
  const { t: tDevice } = useTranslation('device');
  const { t: tCommon } = useTranslation('common');
  const { close } = useModalContext();
  const [value, setValue] = useState(currentName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const inputRef = useRef<InputRef>(null);

  useEffect(() => {
    // Focus + select the whole name so the user can immediately retype.
    queueMicrotask(() => inputRef.current?.select());
  }, []);

  const handleSubmit = useCallback(async () => {
    if (loading) return;
    const name = value.trim();
    if (!name || name === currentName) return;
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
  }, [close, currentName, loading, onSubmit, value]);

  const trimmed = value.trim();
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
        <Button
          disabled={!trimmed || trimmed === currentName}
          loading={loading}
          type={'primary'}
          onClick={handleSubmit}
        >
          {tDevice('workingDirectory.renameBranchAction')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

RenameBranchContent.displayName = 'RenameBranchContent';

/**
 * Branch-name entry for renaming a local branch. Prefills the current name and
 * submits the new one; the dropdown closes before this opens (mirrors the
 * create-branch flow).
 */
export const openRenameBranchModal = (options: {
  currentName: string;
  onSubmit: (name: string) => Promise<string | undefined>;
}): ModalInstance =>
  createModal({
    content: <RenameBranchContent currentName={options.currentName} onSubmit={options.onSubmit} />,
    footer: null,
    maskClosable: true,
    styles: { header: { borderBottom: 'none' } },
    title: t('workingDirectory.renameBranchTitle', { ns: 'device' }),
    width: 'min(90vw, 480px)',
  });
