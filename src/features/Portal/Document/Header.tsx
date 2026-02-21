'use client';

import { Button, Flexbox, Text } from '@lobehub/ui';
import { cx } from 'antd-style';
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { documentService } from '@/services/document';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useNotebookStore } from '@/store/notebook';
import { notebookSelectors } from '@/store/notebook/selectors';
import { oneLineEllipsis } from '@/styles';
import { standardizeIdentifier } from '@/utils/identifier';

import AutoSaveHint from './AutoSaveHint';

const Header = () => {
  const { t } = useTranslation('portal');
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const [topicId, documentId] = useChatStore((s) => [
    s.activeTopicId,
    chatPortalSelectors.portalDocumentId(s),
  ]);

  const [useFetchDocuments, title, fileType] = useNotebookStore((s) => [
    s.useFetchDocuments,
    notebookSelectors.getDocumentById(topicId, documentId)(s)?.title,
    notebookSelectors.getDocumentById(topicId, documentId)(s)?.fileType,
  ]);
  useFetchDocuments(topicId);

  const handleOpenInPageEditor = async () => {
    if (!documentId) return;

    setLoading(true);
    try {
      // Update fileType to custom/document so it appears in page list
      await documentService.updateDocument({
        fileType: 'custom/document',
        id: documentId,
      });

      // Navigate to the page editor
      // Note: /page route automatically adds 'docs_' prefix to the id
      navigate(`/page/${standardizeIdentifier(documentId)}`);
    } finally {
      setLoading(false);
    }
  };

  if (!title) return null;

  return (
    <Flexbox horizontal align={'center'} flex={1} gap={12} justify={'space-between'} width={'100%'}>
      <Flexbox flex={1}>
        <Text className={cx(oneLineEllipsis)} type={'secondary'}>
          {title}
        </Text>
      </Flexbox>
      <Flexbox horizontal align={'center'} gap={8}>
        <AutoSaveHint />
        {fileType !== 'agent/plan' && (
          <Button
            icon={<ExternalLink size={14} />}
            loading={loading}
            size={'small'}
            type={'text'}
            onClick={handleOpenInPageEditor}
          >
            {t('openInPageEditor')}
          </Button>
        )}
      </Flexbox>
    </Flexbox>
  );
};

export default Header;
