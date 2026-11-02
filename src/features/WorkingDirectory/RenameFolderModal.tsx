'use client';

import { isValidDirectoryName } from '@lobechat/utils/directoryName';
import { Button, createModal, Flexbox, Input, Text, useModalContext } from '@lobehub/ui';
import { t } from 'i18next';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface RenameFolderContentProps {
  currentName: string;
  /** Return an error message to keep the dialog open with it, or nothing to close. */
  onSubmit: (name: string) => Promise<string | undefined>;
}

const RenameFolderContent = memo<RenameFolderContentProps>(({ currentName, onSubmit }) => {
  const { t: tDevice } = useTranslation('device');
  const { t: tCommon } = useTranslation('common');
  const { close } = useModalContext();
  const [value, setValue] = useState(currentName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    queueMicrotask(() => inputRef.current?.select());
  }, []);

  const trimmed = value.trim();

  const submit = async () => {
    if (loading || !trimmed || trimmed === currentName) return;
    if (!isValidDirectoryName(trimmed, '')) {
      setError(tDevice('workingDirectory.newFolderInvalidName'));
      return;
    }
    setLoading(true);
    try {
      const message = await onSubmit(trimmed);
      if (message) {
        setError(message);
        return;
      }
      close();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flexbox gap={16}>
      <Flexbox gap={8}>
        <Input
          aria-label={tDevice('workingDirectory.newFolderPlaceholder')}
          readOnly={loading}
          ref={inputRef}
          value={value}
          onPressEnter={() => void submit()}
          onChange={(event) => {
            setValue(event.target.value);
            setError(undefined);
          }}
        />
        {error && (
          <Text fontSize={12} role={'alert'} type={'danger'}>
            {error}
          </Text>
        )}
      </Flexbox>
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button disabled={loading} onClick={close}>
          {tCommon('cancel')}
        </Button>
        <Button
          disabled={!trimmed || trimmed === currentName}
          loading={loading}
          type={'primary'}
          onClick={() => void submit()}
        >
          {tCommon('rename')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

RenameFolderContent.displayName = 'RenameFolderContent';

/** Rename one folder on the drive; nothing is overwritten. */
export const openRenameFolderModal = (props: RenameFolderContentProps) =>
  createModal({
    content: <RenameFolderContent {...props} />,
    footer: null,
    maskClosable: true,
    styles: { header: { borderBottom: 'none' } },
    title: t('workingDirectory.drive.renameTitle', { ns: 'device' }),
    width: 'min(90vw, 420px)',
  });
