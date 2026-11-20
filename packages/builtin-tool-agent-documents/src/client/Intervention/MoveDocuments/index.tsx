'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { MoveDocumentsArgs } from '../../../types';
import { describeCurrentParent, type DocumentRefView } from '../../shared/describeDocumentRef';
import DocumentRef from '../../shared/DocumentRef';
import { cardStyles } from '../../shared/styles';
import { useAgentDocumentLookup } from '../../shared/useAgentDocumentLookup';

/**
 * Approval for moveDocuments: the documents by title, where each sits now, and
 * the destination — the raw ids the model sends say nothing to the user.
 */
const MoveDocumentsIntervention = memo<BuiltinInterventionProps<MoveDocumentsArgs>>(({ args }) => {
  const { t } = useTranslation('plugin');
  const { lookup } = useAgentDocumentLookup();
  const ids = Array.isArray(args?.ids) ? args.ids : [];
  const parentLabel = (view: DocumentRefView) => {
    if (view.kind === 'root') return t('builtins.lobe-agent-documents.ref.root');
    return view.kind === 'unknown' ? view.id : view.title;
  };

  return (
    <Flexbox gap={8}>
      <Flexbox horizontal align={'center'} className={cardStyles.card} gap={8}>
        <Text className={cardStyles.label}>
          {t('builtins.lobe-agent-documents.moveDocuments.destination')}
        </Text>
        <DocumentRef strong lookup={lookup} refId={args?.parentId} />
      </Flexbox>
      <Text type={'secondary'}>
        {t('builtins.lobe-agent-documents.moveDocuments.itemsToMove', { count: ids.length })}
      </Text>
      <Flexbox gap={2}>
        {ids.map((id) => (
          <Flexbox horizontal align={'center'} className={cardStyles.row} gap={8} key={id}>
            <Flexbox flex={2} style={{ minWidth: 0 }}>
              <DocumentRef lookup={lookup} refId={id} />
            </Flexbox>
            <Flexbox align={'flex-end'} flex={1} style={{ minWidth: 0 }}>
              <Text ellipsis type={'secondary'}>
                {t('builtins.lobe-agent-documents.moveDocuments.from', {
                  parent: parentLabel(describeCurrentParent(lookup, id)),
                })}
              </Text>
            </Flexbox>
          </Flexbox>
        ))}
      </Flexbox>
    </Flexbox>
  );
});

MoveDocumentsIntervention.displayName = 'AgentDocumentsMoveDocumentsIntervention';

export default MoveDocumentsIntervention;
