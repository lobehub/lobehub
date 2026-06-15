'use client';

import { Flexbox, Skeleton, Text } from '@lobehub/ui';
import { cx } from 'antd-style';

import { useClientDataSWR } from '@/libs/swr';
import { portalKeys } from '@/libs/swr/keys';
import { documentService } from '@/services/document';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { oneLineEllipsis } from '@/styles';
import { getDocumentRenderMode } from '@/utils/documentRenderMode';

import AutoSaveHint from './AutoSaveHint';

const Header = () => {
  const documentId = useChatStore(chatPortalSelectors.portalDocumentId);

  const { data: document, isLoading } = useClientDataSWR(
    documentId ? portalKeys.documentHeader(documentId) : null,
    () => documentService.getDocumentById(documentId!),
  );

  const title = document?.filename || document?.title;
  const isReadonly = !!document && getDocumentRenderMode(document).mode === 'highlight';

  if (!documentId) return null;

  if (isLoading || !title) {
    return (
      <Flexbox
        horizontal
        align={'center'}
        flex={1}
        gap={12}
        justify={'space-between'}
        width={'100%'}
      >
        <Flexbox flex={1}>
          <Skeleton.Button active size={'small'} style={{ height: 16, width: 180 }} />
        </Flexbox>
      </Flexbox>
    );
  }

  return (
    <Flexbox horizontal align={'center'} flex={1} gap={12} justify={'space-between'} width={'100%'}>
      <Flexbox flex={1}>
        <Text className={cx(oneLineEllipsis)} type={'secondary'}>
          {title}
        </Text>
      </Flexbox>
      {!isReadonly && (
        <Flexbox horizontal align={'center'} gap={8}>
          <AutoSaveHint />
        </Flexbox>
      )}
    </Flexbox>
  );
};

export default Header;
