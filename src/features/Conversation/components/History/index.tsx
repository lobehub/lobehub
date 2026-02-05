import { ModelTag } from '@lobehub/icons';
import { Center, Flexbox, Icon, Markdown, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ScrollText } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { agentChatConfigSelectors } from '@/store/agent/selectors';
import { useAgentStore } from '@/store/agent/store';

import { dataSelectors, useConversationStore } from '../../store';
import HistoryDivider from './HistoryDivider';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding-inline: 12px;
    border-radius: 12px;
  `,
  content: css`
    color: ${cssVar.colorTextDescription};
  `,
  line: css`
    width: 3px;
    height: 100%;
    background: ${cssVar.colorBorder};
  `,
}));

const History = memo(() => {
  const { t } = useTranslation('chat');
  const [content, model] = useConversationStore(() => {
    const history = dataSelectors.currentTopicSummary();
    return [history?.content, history?.model];
  });

  const enableCompressHistory = useAgentStore(
    (s) => agentChatConfigSelectors.currentChatConfig(s).enableCompressHistory,
  );

  return (
    <Flexbox paddingInline={16} style={{ paddingBottom: 8 }}>
      <HistoryDivider enable />
      {enableCompressHistory && !!content && (
        <Flexbox className={styles.container} gap={8}>
          <Flexbox horizontal align={'flex-start'} gap={8}>
            <Center height={20} width={20}>
              <Icon icon={ScrollText} size={16} style={{ color: cssVar.colorTextDescription }} />
            </Center>
            <Text type={'secondary'}>{t('historySummary')}</Text>
            {model && (
              <div>
                <ModelTag model={model} />
              </div>
            )}
          </Flexbox>
          <Flexbox horizontal align={'flex-start'} gap={8}>
            <Flexbox align={'center'} padding={8} width={20}>
              <div className={styles.line} />
            </Flexbox>
            <Markdown className={styles.content} variant={'chat'}>
              {content}
            </Markdown>
          </Flexbox>
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default History;
