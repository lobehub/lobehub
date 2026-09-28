import { Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, type DropdownItem, DropdownMenu, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { FilePlusIcon, FileUp, FolderPlusIcon, PlusIcon } from 'lucide-react';
import { memo, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  toolbar: css`
    margin-inline: 6px;
    color: ${cssVar.colorTextSecondary};
  `,
  title: css`
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  `,
}));

interface Props {
  onCreateDocument: () => void;
  onCreateFolder: () => void;
  onUploadFiles: (files: File[]) => void;
}

const DocumentExplorerToolbar = memo<Props>(
  ({ onCreateDocument, onCreateFolder, onUploadFiles }) => {
    const { t } = useTranslation('chat');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const createMenuItems = useMemo<DropdownItem[]>(
      () => [
        {
          icon: <Icon icon={FilePlusIcon} />,
          key: 'new-document',
          label: t('workingPanel.resources.tree.newDocument'),
          onClick: onCreateDocument,
        },
        {
          icon: <Icon icon={FolderPlusIcon} />,
          key: 'new-folder',
          label: t('workingPanel.resources.tree.newFolder'),
          onClick: onCreateFolder,
        },
        { type: 'divider' as const },
        {
          icon: <Icon icon={FileUp} />,
          key: 'upload-file',
          label: t('workingPanel.resources.tree.uploadFile'),
          onClick: () => fileInputRef.current?.click(),
        },
      ],
      [onCreateDocument, onCreateFolder, t],
    );

    return (
      <Flexbox
        horizontal
        align={'center'}
        className={styles.toolbar}
        distribution={'space-between'}
      >
        <Text className={styles.title} type={'secondary'}>
          {t('workingPanel.resources.filter.documents')}
        </Text>
        <DropdownMenu items={createMenuItems} placement={'bottomRight'}>
          <ActionIcon
            icon={PlusIcon}
            size={'small'}
            title={t('workingPanel.resources.tree.create')}
          />
        </DropdownMenu>
        <input
          hidden
          multiple
          ref={fileInputRef}
          type={'file'}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            if (files.length === 0) return;
            onUploadFiles(files);
          }}
        />
      </Flexbox>
    );
  },
);

DocumentExplorerToolbar.displayName = 'DocumentExplorerToolbar';

export default DocumentExplorerToolbar;
