'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '@/features/Conversation';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    padding-block: 8px;
    padding-inline: 16px;
    border-radius: 48px;
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
  const { t } = useTranslation('welcome');
  const [sendMessage] = useConversationStore((s) => [s.sendMessage]);

  return (
    <div className={styles.container}>
      <p className={styles.title}>{t('guide.questions.title')}</p>
      <Flexbox horizontal gap={8} wrap={'wrap'}>
        {questions.slice(0, 5).map((question) => (
          <Block
            clickable
            className={styles.card}
            key={question}
            paddingBlock={8}
            paddingInline={12}
            variant={'filled'}
            onClick={() => {
              sendMessage({ message: question });
            }}
          >
            {question}
          </Block>
        ))}
      </Flexbox>
    </div>
  );
});

export default OpeningQuestions;
