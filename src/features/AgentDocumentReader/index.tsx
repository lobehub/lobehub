'use client';

import { Button } from '@lobehub/ui/base-ui';
import ActionIcon from '@lobehub/ui/es/ActionIcon/index';
import { Center, Flexbox } from '@lobehub/ui/es/Flex/index';
import Markdown from '@lobehub/ui/es/Markdown/index';
import Text from '@lobehub/ui/es/Text/index';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import WorkbenchLoading from '@/features/WorkbenchShell/WorkbenchLoading';
import { agentDocumentService, agentDocumentSWRKeys } from '@/services/agentDocument';

const styles = createStaticStyles(({ css }) => ({
  article: css`
    width: 100%;
    max-width: 840px;
    margin-inline: auto;
    padding-block: 28px 80px;
    padding-inline: 20px;
  `,
  body: css`
    overflow: auto;
    flex: 1;
    min-height: 0;
  `,
  header: css`
    flex: none;

    min-height: 52px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  page: css`
    width: 100%;
    height: 100dvh;
    background: ${cssVar.colorBgContainer};
  `,
}));

interface AgentDocumentReaderProps {
  agentId: string;
  documentId: string;
}

const AgentDocumentReader = memo<AgentDocumentReaderProps>(({ agentId, documentId }) => {
  const { t } = useTranslation('common');
  const { data, error, isLoading, mutate } = useSWR(
    agentId && documentId ? agentDocumentSWRKeys.readerDocument(agentId, documentId) : null,
    () => agentDocumentService.getReaderDocument({ agentId, documentId }),
    { revalidateOnFocus: false },
  );

  const backToAgent = () => window.location.assign(`/agent/${agentId}`);
  const title = data?.title || data?.filename || '';

  return (
    <Flexbox className={styles.page}>
      <Flexbox horizontal align={'center'} className={styles.header} gap={8}>
        <ActionIcon icon={ArrowLeft} title={t('back')} onClick={backToAgent} />
        <Text ellipsis strong style={{ flex: 1, minWidth: 0 }} title={title}>
          {title}
        </Text>
      </Flexbox>
      <div className={styles.body}>
        {!error && isLoading ? (
          <Center height={'100%'}>
            <WorkbenchLoading />
          </Center>
        ) : error ? (
          <Center gap={16} height={'100%'} padding={24}>
            <Text type={'secondary'}>{error.message}</Text>
            <Button
              icon={RefreshCw}
              onClick={() => {
                void mutate();
              }}
            >
              {t('retry')}
            </Button>
          </Center>
        ) : (
          <article className={styles.article}>
            {data?.content ? <Markdown>{data.content}</Markdown> : <Center padding={64}>—</Center>}
          </article>
        )}
      </div>
    </Flexbox>
  );
});

AgentDocumentReader.displayName = 'AgentDocumentReader';

export default AgentDocumentReader;
