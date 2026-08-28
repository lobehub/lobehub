import { Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, type DropdownItem, DropdownMenu, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { FilePlusIcon, FolderPlusIcon, PlusIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  toolbar: css`
    /* padding-inline start matches a tree row's content edge:
       --trees-padding-inline (4) - --trees-item-margin-x (4), clamped at 0,
       plus the row's own margin (4) and padding (8). */
    padding-block: 8px 4px;
    padding-inline: 12px 8px;
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
