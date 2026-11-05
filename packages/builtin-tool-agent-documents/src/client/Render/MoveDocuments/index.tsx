'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { MoveDocumentsArgs, MoveDocumentsState } from '../../../types';
import DocumentRef from '../../shared/DocumentRef';
import { cardStyles } from '../../shared/styles';
import { useAgentDocumentLookup } from '../../shared/useAgentDocumentLookup';

const STATUS_TYPE = { failed: 'danger', moved: 'success', unchanged: 'secondary' } as const;

/** Result of moveDocuments: destination, then each document with its outcome. */
const MoveDocumentsRender = memo<
  Pick<BuiltinRenderProps<MoveDocumentsArgs, MoveDocumentsState>, 'args' | 'pluginState'>
>(({ args, pluginState }) => {
  const { t } = useTranslation('plugin');
  const { lookup } = useAgentDocumentLookup();
  const results =
    pluginState?.results ??
    (Array.isArray(args?.ids) ? args.ids.map((id) => ({ id, status: undefined })) : []);
  if (results.length === 0) return null;

  return (
    <Flexbox gap={8}>
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(cardStyles.card).className}
        gap={8}
      >
        <Text className={stylex.props(cardStyles.label).className}>
          {t('builtins.lobe-agent-documents.moveDocuments.destination')}
        </Text>
        <DocumentRef strong lookup={lookup} refId={pluginState?.parentId ?? args?.parentId} />
      </Flexbox>
      <Flexbox gap={2}>
        {results.map((item) => (
          <Flexbox gap={2} key={item.id}>
            <Flexbox
              horizontal
              align={'center'}
              className={stylex.props(cardStyles.row).className}
              gap={8}
            >
              <Flexbox flex={1} style={{ minWidth: 0 }}>
                <DocumentRef
                  fallbackTitle={'title' in item ? item.title : undefined}
                  lookup={lookup}
                  refId={item.id}
                />
              </Flexbox>
              {item.status && (
                <Text
                  className={stylex.props(cardStyles.status).className}
                  type={STATUS_TYPE[item.status]}
                >
                  {t(`builtins.lobe-agent-documents.moveDocuments.status.${item.status}`)}
                </Text>
              )}
            </Flexbox>
            {'error' in item && item.error && (
              <Text style={{ paddingInline: 12 }} type={'danger'}>
                {item.error}
              </Text>
            )}
          </Flexbox>
        ))}
      </Flexbox>
    </Flexbox>
  );
});

MoveDocumentsRender.displayName = 'AgentDocumentsMoveDocumentsRender';

export default MoveDocumentsRender;
