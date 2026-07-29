'use client';

import { Block, Flexbox, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '@/features/Conversation';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    padding-block: 8px;
    padding-inline: 16px;
    border-radius: 48px;
  `,
  cardDisabled: css`
    cursor: not-allowed;
    opacity: 0.55;
  `,
  container: css`
    padding-block: 0;
    padding-inline: 0;
  `,
  title: css`
    color: ${cssVar.colorTextDescription};
  `,
}));

interface OpeningQuestionsProps {
  questions: string[];
}

const OpeningQuestions = memo<OpeningQuestionsProps>(({ questions }) => {
  const { t } = useTranslation(['welcome', 'chat']);
  const [sendMessage] = useConversationStore((s) => [s.sendMessage]);

  // Same per-resource General-access gating as the chat input below (see
  // useChatInputResourceAccess): inbox and private agents are never gated.
  const agentId = useAgentStore((s) => s.activeAgentId);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const agentVisibility = useAgentStore((s) =>
    s.activeAgentId ? s.agentMap[s.activeAgentId]?.visibility : undefined,
  );
  const gatedResourceId =
    agentId && agentId !== inboxAgentId && agentVisibility !== 'private' ? agentId : undefined;
  const { canUseResource } = useResourceAccess('agent', gatedResourceId);

  return (
    <div className={styles.container}>
      <p className={styles.title}>{t('guide.questions.title')}</p>
      <Flexbox horizontal gap={8} wrap={'wrap'}>
        {questions.slice(0, 5).map((question) => {
          const card = (
            <Block
              className={cx(styles.card, !canUseResource && styles.cardDisabled)}
              clickable={canUseResource}
              key={question}
              paddingBlock={8}
              paddingInline={12}
              variant={'filled'}
              onClick={
                canUseResource
                  ? () => {
                      sendMessage({ message: question });
                    }
                  : undefined
              }
            >
              {question}
            </Block>
          );

          return canUseResource ? (
            card
          ) : (
            <Tooltip key={question} title={t('input.viewOnlyAgent', { ns: 'chat' })}>
              {card}
            </Tooltip>
          );
        })}
      </Flexbox>
    </div>
  );
});

export default OpeningQuestions;
