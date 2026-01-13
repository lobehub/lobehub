import { Center } from '@lobehub/ui';
import { TypewriterEffect } from '@lobehub/ui/awesome';
import { LoadingDots } from '@lobehub/ui/chat';
import { cssVar } from 'antd-style';
import { shuffle } from 'es-toolkit/compat';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

const WelcomeText = memo(() => {
  const { t } = useTranslation('welcome');

  const sentences = useMemo(() => {
    const messages = t('welcomeMessages', { returnObjects: true }) as Record<string, string>;
    return shuffle(Object.values(messages));
  }, [t]);

  return (
    <Center
      style={{
        fontSize: 28,
        fontWeight: 'bold',
        marginBlock: '36px 24px',
      }}
    >
      <TypewriterEffect
        cursorCharacter={<LoadingDots color={cssVar.colorText} size={20} variant={'pulse'} />}
        cursorFade={false}
        deletePauseDuration={1000}
        deletingSpeed={32}
        hideCursorWhileTyping={'afterTyping'}
        pauseDuration={16_000}
        sentences={sentences}
        typingSpeed={64}
      />
    </Center>
  );
});

export default WelcomeText;
