import { type NotebookDocument } from '@lobechat/types';
import { ActionIcon, confirmModal, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { FileTextIcon, Trash2Icon } from 'lucide-react';
import { type MouseEvent } from 'react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { useNotebookStore } from '@/store/notebook';

const styles = stylex.create({
  container: {
    cursor: 'pointer',
    padding: '12px',
    borderRadius: '8px',
    backgroundColor: { 'default': cssVar.colorFillTertiary, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
  },
  description: { fontSize: '12px', lineHeight: 1.5, color: cssVar.colorTextSecondary },
  title: { fontWeight: 500 },
});

interface DocumentItemProps {
  document: NotebookDocument;
  topicId: string;
}

const DocumentItem = memo<DocumentItemProps>(({ document, topicId }) => {
  const { t } = useTranslation('portal');
  const [deleting, setDeleting] = useState(false);

  const openDocument = useChatStore((s) => s.openDocument);
  const deleteDocument = useNotebookStore((s) => s.deleteDocument);

  const handleClick = () => {
    openDocument(document.id);
  };

  const handleDelete = async (e: MouseEvent) => {
    e.stopPropagation();

    confirmModal({
      okButtonProps: { danger: true },
      onOk: async () => {
        setDeleting(true);
        try {
          await deleteDocument(document.id, topicId);
        } finally {
          setDeleting(false);
        }
      },
      content: t('notebook.confirmDelete'),
      okText: t('delete', { ns: 'common' }),
      title: t('delete', { ns: 'common' }),
    });
  };

  return (
    <Flexbox
      horizontal
      className={stylex.props(styles.container).className}
      gap={8}
      onClick={handleClick}
    >
      <FileTextIcon size={16} />
      <Flexbox gap={4} style={{ flex: 1, minWidth: 0 }}>
        <Flexbox horizontal align={'center'} distribution={'space-between'}>
          <Text ellipsis className={stylex.props(styles.title).className}>
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
          <Text className={stylex.props(styles.description).className} ellipsis={{ rows: 2 }}>
            {document.description}
          </Text>
        )}
      </Flexbox>
    </Flexbox>
  );
});

export default DocumentItem;
