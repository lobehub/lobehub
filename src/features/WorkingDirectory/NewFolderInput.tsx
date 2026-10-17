'use client';

import { Button, cssVar, Flexbox, Icon, Input, Text } from '@lobehub/ui';
import { FolderPlusIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { DirectorySource } from './directorySource';
import { useCreateFolder } from './useCreateFolder';

interface NewFolderInputProps {
  onCancel: () => void;
  onCreated: (path: string) => void;
  parentPath: string;
  /** Only how a folder is made — what a picker and a file manager have in common. */
  source: Pick<DirectorySource, 'createFolder' | 'folderErrorKey' | 'renderNewFolderOptions'>;
}

/**
 * Inline row that names and creates a folder inside the folder being browsed,
 * with whatever else the source asks alongside the name.
 */
export const NewFolderInput = ({
  onCancel,
  onCreated,
  parentPath,
  source,
}: NewFolderInputProps) => {
  const { t } = useTranslation('device');
  const { t: tCommon } = useTranslation('common');
  const { error, name, options, pending, setName, setOptions, submit } = useCreateFolder({
    create: source.createFolder,
    errorMessageKey: source.folderErrorKey,
    onCreated,
    parentPath,
  });

  return (
    <Flexbox flex={'none'} gap={4} paddingBlock={4}>
      <Flexbox horizontal align={'center'} gap={8}>
        {/* `readOnly` while pending, not `disabled`: disabling the focused field
            inside the modal's focus trap froze the page in a busy loop once the
            create resolved. */}
        <Input
          autoFocus
          aria-label={t('workingDirectory.newFolderPlaceholder')}
          placeholder={t('workingDirectory.newFolderPlaceholder')}
          prefix={<Icon color={cssVar.colorTextTertiary} icon={FolderPlusIcon} size={16} />}
          readOnly={pending}
          style={{ flex: 1, minWidth: 0 }}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onPressEnter={() => void submit()}
          onKeyDown={(event) => {
            // Esc dismisses only this row; the surrounding modal stays open.
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            if (!pending) onCancel();
          }}
        />
        <Button disabled={pending} onClick={onCancel}>
          {tCommon('cancel')}
        </Button>
        <Button disabled={!name.trim()} loading={pending} onClick={() => void submit()}>
          {t('workingDirectory.newFolderCreate')}
        </Button>
      </Flexbox>
      {source.renderNewFolderOptions?.({ onChange: setOptions, value: options })}
      {error && (
        <Text fontSize={12} role={'alert'} type={'danger'}>
          {error}
        </Text>
      )}
    </Flexbox>
  );
};
