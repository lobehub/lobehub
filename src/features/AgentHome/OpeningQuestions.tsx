'use client';

import { Block, Flexbox, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '@/features/Conversation';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';

const styles = stylex.create({
  card: { paddingBlock: '8px', paddingInline: '16px', borderRadius: '48px' },
  cardDisabled: { cursor: 'not-allowed', opacity: 0.55 },
  container: { paddingBlock: '0', paddingInline: '0' },
  title: { color: cssVar.colorTextDescription },
});

interface OpeningQuestionsProps {
  questions: string[];
}

const OpeningQuestions = memo<OpeningQuestionsProps>(({ questions }) => {
  const { t } = useTranslation(['welcome', 'chat']);
  const fillInputMessage = useConversationStore((s) => s.fillInputMessage);

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
    <div {...stylex.props(styles.container)}>
      <p {...stylex.props(styles.title)}>{t('guide.questions.title')}</p>
      <Flexbox horizontal gap={8} wrap={'wrap'}>
        {questions.slice(0, 5).map((question) => {
          const card = (
            <Block
              clickable={canUseResource}
              key={question}
              paddingBlock={8}
              paddingInline={12}
              variant={'filled'}
              className={
                stylex.props(styles.card, !canUseResource && styles.cardDisabled).className
              }
              onClick={
                canUseResource
                  ? () => {
                      fillInputMessage(question);
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
