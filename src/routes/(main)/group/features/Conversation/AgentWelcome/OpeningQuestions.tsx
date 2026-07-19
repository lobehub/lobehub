'use client';

import { Block, Flexbox, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cx, responsive } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '@/features/Conversation';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    padding-block: 8px;
    padding-inline: 16px;
    border-radius: 48px;

    ${responsive.sm} {
      padding-block: 8px;
      padding-inline: 16px;
    }
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
  mobile?: boolean;
  questions: string[];
}

const OpeningQuestions = memo<OpeningQuestionsProps>(({ mobile, questions }) => {
  const { t } = useTranslation(['welcome', 'chat']);
  const [sendMessage] = useConversationStore((s) => [s.sendMessage]);

  // Same per-resource General-access gating as the chat input (see
  // useChatInputResourceAccess): private groups are never gated.
  const activeGroup = useAgentGroupStore((s) =>
    s.activeGroupId ? agentGroupSelectors.getGroupById(s.activeGroupId)(s) : undefined,
  );
  const gatedResourceId =
    activeGroup && activeGroup.visibility !== 'private' ? activeGroup.id : undefined;
  const { canUseResource } = useResourceAccess('agentGroup', gatedResourceId);

  return (
    <div className={styles.container}>
      <p className={styles.title}>{t('guide.questions.title')}</p>
      <Flexbox horizontal gap={8} wrap={'wrap'}>
        {questions.slice(0, mobile ? 2 : 5).map((question) => {
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
            <Tooltip key={question} title={t('input.viewOnlyGroup', { ns: 'chat' })}>
              {card}
            </Tooltip>
          );
        })}
      </Flexbox>
    </div>
  );
});

export default OpeningQuestions;
