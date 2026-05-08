import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { FilePlusIcon, FolderPlusIcon } from 'lucide-react';
import { memo } from 'react';
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
  return (
    <Flexbox horizontal align={'center'} className={styles.toolbar} distribution={'space-between'}>
      <Text className={styles.title} type={'secondary'}>
        {t('workingPanel.resources.filter.documents')}
      </Text>
      <Flexbox horizontal gap={2}>
        <ActionIcon
          icon={FolderPlusIcon}
          size={'small'}
          title={t('workingPanel.resources.tree.newFolder')}
          onClick={onCreateFolder}
        />
        <ActionIcon
          icon={FilePlusIcon}
          size={'small'}
          title={t('workingPanel.resources.tree.newDocument')}
          onClick={onCreateDocument}
        />
      </Flexbox>
    </Flexbox>
  );
});

DocumentExplorerToolbar.displayName = 'DocumentExplorerToolbar';

export default DocumentExplorerToolbar;
