'use client';

import { Button } from '@lobehub/ui';
import ActionIcon from '@lobehub/ui/es/ActionIcon/index';
import { Center, Flexbox } from '@lobehub/ui/es/Flex/index';
import Markdown from '@lobehub/ui/es/Markdown/index';
import Text from '@lobehub/ui/es/Text/index';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import ContentLoading from '@/components/Loading/ContentLoading';
import {
  agentDocumentActions,
  agentDocumentSelectors,
  useAgentDocumentStore,
} from '@/store/agentDocument';

const styles = stylex.create({
  article: {
    width: '100%',
    maxWidth: '840px',
    marginInline: 'auto',
    paddingBlockStart: '28px',
    paddingBlockEnd: '80px',
    paddingInline: '20px',
  },
  body: { overflow: 'auto', flex: '1', minHeight: '0' },
  header: {
    flex: 'none',
    minHeight: '52px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  page: {
    width: '100%',
    height: '100dvh',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
});

interface AgentDocumentReaderProps {
  agentId: string;
  documentId: string;
}

const AgentDocumentReader = memo<AgentDocumentReaderProps>(({ agentId, documentId }) => {
  const { t } = useTranslation('common');
  const params = useMemo(
    () => (agentId && documentId ? { agentId, documentId } : null),
    [agentId, documentId],
  );
  // A reader replica: a revisit paints the last body read and the network only
  // confirms it. Loading / error take over only while there is nothing to show.
  const { error: syncError, revalidate } = agentDocumentActions.useFetchReaderDocument(params);
  const entry = useAgentDocumentStore(agentDocumentSelectors.getReaderDocument(params));
  const data = entry?.document ?? undefined;
  const error = data
    ? undefined
    : entry?.document === null
      ? new Error(entry.missingMessage)
      : (syncError as Error | undefined);
  const isLoading = !!params && !entry && !error;

  const backToAgent = () => window.location.assign(`/agent/${agentId}`);
  const title = data?.title || data?.filename || '';

  return (
    <Flexbox className={stylex.props(styles.page).className}>
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.header).className}
        gap={8}
      >
        <ActionIcon icon={ArrowLeft} title={t('back')} onClick={backToAgent} />
        <Text ellipsis strong style={{ flex: 1, minWidth: 0 }} title={title}>
          {title}
        </Text>
      </Flexbox>
      <div {...stylex.props(styles.body)}>
        {!error && isLoading ? (
          <Center height={'100%'}>
            <ContentLoading />
          </Center>
        ) : error ? (
          <Center gap={16} height={'100%'} padding={24}>
            <Text type={'secondary'}>{error.message}</Text>
            <Button
              icon={RefreshCw}
              onClick={() => {
                void revalidate();
              }}
            >
              {t('retry')}
            </Button>
          </Center>
        ) : (
          <article {...stylex.props(styles.article)}>
            {data?.content ? <Markdown>{data.content}</Markdown> : <Center padding={64}>—</Center>}
          </article>
        )}
      </div>
    </Flexbox>
  );
});

AgentDocumentReader.displayName = 'AgentDocumentReader';

export default AgentDocumentReader;
