'use client';

import { ActionIcon, Button, Flexbox, Text } from '@lobehub/ui';
import { cx } from 'antd-style';
import { ArrowLeft, ExternalLink } from 'lucide-react';
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

  const [topicId, documentId, closeDocument] = useChatStore((s) => [
    s.activeTopicId,
    chatPortalSelectors.portalDocumentId(s),
    s.closeDocument,
  ]);

  const document = useNotebookStore(notebookSelectors.getDocumentById(topicId, documentId));

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

  if (!document) return null;

  return (
    <Flexbox align={'center'} flex={1} gap={12} horizontal justify={'space-between'} width={'100%'}>
      <Flexbox align={'center'} gap={4} horizontal>
        <ActionIcon icon={ArrowLeft} onClick={closeDocument} size={'small'} />
        <Text className={cx(oneLineEllipsis)} type={'secondary'}>
          {document.title}
        </Text>
      </Flexbox>
      <Flexbox align={'center'} gap={8} horizontal>
        <AutoSaveHint />
        {document.fileType !== 'agent/plan' && (
          <Button
            icon={<ExternalLink size={14} />}
            loading={loading}
            onClick={handleOpenInPageEditor}
            size={'small'}
            type={'text'}
          >
            {t('openInPageEditor')}
          </Button>
        )}
      </Flexbox>
    </Flexbox>
  );
};

export default Header;
