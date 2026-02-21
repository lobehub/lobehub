import { type NotebookDocument } from '@lobechat/types';
import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { FileTextIcon, Trash2Icon } from 'lucide-react';
import { type MouseEvent } from 'react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { useNotebookStore } from '@/store/notebook';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    cursor: pointer;
    padding: 12px;
    border-radius: 8px;
    background: ${cssVar.colorFillTertiary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  description: css`
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
  `,
  title: css`
    font-weight: 500;
  `,
}));

interface DocumentItemProps {
  document: NotebookDocument;
  topicId: string;
}

const DocumentItem = memo<DocumentItemProps>(({ document, topicId }) => {
  const { t } = useTranslation('portal');
  const { modal } = App.useApp();
  const [deleting, setDeleting] = useState(false);

  const openDocument = useChatStore((s) => s.openDocument);
  const deleteDocument = useNotebookStore((s) => s.deleteDocument);

  const handleClick = () => {
    openDocument(document.id);
  };

  const handleDelete = async (e: MouseEvent) => {
    e.stopPropagation();

    modal.confirm({
      centered: true,
      okButtonProps: { danger: true },
      onOk: async () => {
        setDeleting(true);
        try {
          await deleteDocument(document.id, topicId);
        } finally {
          setDeleting(false);
        }
      },
      title: t('notebook.confirmDelete'),
    });
  };

  return (
    <Flexbox horizontal className={styles.container} gap={8} onClick={handleClick}>
      <FileTextIcon size={16} />
      <Flexbox gap={4} style={{ flex: 1, minWidth: 0 }}>
        <Flexbox horizontal align={'center'} distribution={'space-between'}>
          <Text ellipsis className={styles.title}>
            {document.title}
          </Text>
          <ActionIcon
            icon={Trash2Icon}
            loading={deleting}
            size={'small'}
            title={t('notebook.delete')}
            onClick={handleDelete}
          />
        </Flexbox>
        {document.description && (
          <Text className={styles.description} ellipsis={{ rows: 2 }}>
            {document.description}
          </Text>
        )}
      </Flexbox>
    </Flexbox>
  );
});

export default DocumentItem;
