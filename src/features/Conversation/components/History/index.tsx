import { Center, Flexbox, Icon, Markdown, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ScrollText } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ModelTag } from '@/components/LobeIcons';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useAgentStore } from '@/store/agent/store';

import { contextSelectors, dataSelectors, useConversationStore } from '../../store';
import HistoryDivider from './HistoryDivider';

const styles = stylex.create({
  container: { paddingInline: '12px', borderRadius: '12px' },
  content: { color: cssVar.colorTextDescription },
  line: {
    width: '3px',
    height: '100%',
    backgroundColor: cssVar.colorBorder,
    backgroundImage: 'none',
  },
});

const History = memo(() => {
  const { t } = useTranslation('chat');
  const [content, model] = useConversationStore(() => {
    const history = dataSelectors.currentTopicSummary();
    return [history?.content, history?.model];
  });

  const agentId = useConversationStore(contextSelectors.agentId);
  const enableCompressHistory = useAgentStore(
    (s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s).enableCompressHistory,
  );

  return (
    <Flexbox paddingInline={16} style={{ paddingBottom: 8 }}>
      <HistoryDivider enable />
      {enableCompressHistory && !!content && (
        <Flexbox className={stylex.props(styles.container).className} gap={8}>
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
              <div {...stylex.props(styles.line)} />
            </Flexbox>
            <Markdown className={stylex.props(styles.content).className} variant={'chat'}>
              {content}
            </Markdown>
          </Flexbox>
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default History;
