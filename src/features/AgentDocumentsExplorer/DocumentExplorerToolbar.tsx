import { ActionIcon, Flexbox, Icon, Text } from '@lobehub/ui';
import { type DropdownItem, DropdownMenu } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { FilePlusIcon, FolderPlusIcon, PlusIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  toolbar: css`
    padding-block: 4px;
    padding-inline: 12px 4px;
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
}

const DocumentExplorerToolbar = memo<Props>(({ onCreateDocument, onCreateFolder }) => {
  const { t } = useTranslation('chat');
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
    ],
    [onCreateDocument, onCreateFolder, t],
  );

  return (
    <Flexbox horizontal align={'center'} className={styles.toolbar} distribution={'space-between'}>
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
    </Flexbox>
  );
});

DocumentExplorerToolbar.displayName = 'DocumentExplorerToolbar';

export default DocumentExplorerToolbar;
