'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { FolderIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { CreateFolderArgs, CreateFolderState } from '../../../types';
import DocumentRef from '../../shared/DocumentRef';
import { cardStyles } from '../../shared/styles';
import { useAgentDocumentLookup } from '../../shared/useAgentDocumentLookup';

/** Result of createFolder: the folder, where it lives, and whether it was reused. */
const CreateFolderRender = memo<
  Pick<BuiltinRenderProps<CreateFolderArgs, CreateFolderState>, 'args' | 'pluginState'>
>(({ args, pluginState }) => {
  const { t } = useTranslation('plugin');
  const { lookup } = useAgentDocumentLookup();
  const title = pluginState?.title || args?.title;
  if (!title) return null;

  return (
    <Flexbox className={cardStyles.card} gap={6}>
      <Flexbox horizontal align={'center'} gap={8}>
        <Icon className={cardStyles.arrow} icon={FolderIcon} size={16} />
        <Text strong>{title}</Text>
        {pluginState && (
          <Text className={cardStyles.status} type={'secondary'}>
            {t(
              pluginState.created
                ? 'builtins.lobe-agent-documents.createFolder.created'
                : 'builtins.lobe-agent-documents.createFolder.reused',
            )}
          </Text>
        )}
      </Flexbox>
      <Flexbox horizontal align={'center'} gap={8}>
        <Text className={cardStyles.label}>{t('builtins.lobe-agent-documents.ref.location')}</Text>
        <DocumentRef lookup={lookup} refId={args?.parentId} />
      </Flexbox>
    </Flexbox>
  );
});

CreateFolderRender.displayName = 'AgentDocumentsCreateFolderRender';

export default CreateFolderRender;
