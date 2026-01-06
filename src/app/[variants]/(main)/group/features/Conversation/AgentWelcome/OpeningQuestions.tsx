'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { createStaticStyles , responsive } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

// import { useSend } from '../../features/ChatInput/useSend';

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
  const { t } = useTranslation('welcome');
  const [updateMessageInput] = useChatStore((s) => [s.updateMessageInput]);
  // const { send: sendMessage } = useSend();

  return (
    <div className={styles.container}>
      <p className={styles.title}>{t('guide.questions.title')}</p>
      <Flexbox gap={8} horizontal wrap={'wrap'}>
        {questions.slice(0, mobile ? 2 : 5).map((question) => {
          return (
            <Block
              className={styles.card}
              clickable
              key={question}
              onClick={() => {
                updateMessageInput(question);
                // sendMessage({ isWelcomeQuestion: true });
              }}
              paddingBlock={8}
              paddingInline={12}
              variant={'filled'}
            >
              {question}
            </Block>
          );
        })}
      </Flexbox>
    </div>
  );
});

export default OpeningQuestions;
