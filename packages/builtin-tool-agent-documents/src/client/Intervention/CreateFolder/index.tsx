'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { FolderPlusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { CreateFolderArgs } from '../../../types';
import DocumentRef from '../../shared/DocumentRef';
import { cardStyles } from '../../shared/styles';
import { useAgentDocumentLookup } from '../../shared/useAgentDocumentLookup';

/** Approval for createFolder: which folder, and where it will appear. */
const CreateFolderIntervention = memo<BuiltinInterventionProps<CreateFolderArgs>>(({ args }) => {
  const { t } = useTranslation('plugin');
  const { lookup } = useAgentDocumentLookup();

  return (
    <Flexbox className={cardStyles.card} gap={6}>
      <Flexbox horizontal align={'center'} gap={8}>
        <Icon className={cardStyles.arrow} icon={FolderPlusIcon} size={16} />
        <Text strong>{args?.title}</Text>
      </Flexbox>
      <Flexbox horizontal align={'center'} gap={8}>
        <Text className={cardStyles.label}>{t('builtins.lobe-agent-documents.ref.location')}</Text>
        <DocumentRef lookup={lookup} refId={args?.parentId} />
      </Flexbox>
    </Flexbox>
  );
});

CreateFolderIntervention.displayName = 'AgentDocumentsCreateFolderIntervention';

export default CreateFolderIntervention;
