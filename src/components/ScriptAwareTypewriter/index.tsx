'use client';

import { TypewriterEffect } from '@lobehub/ui/awesome';
import { LoadingDots } from '@lobehub/ui/chat';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import PlainTypewriter from '@/components/PlainTypewriter';
import { textNeedsCursiveJoining } from '@/utils/cursiveScript';

export interface ScriptAwareTypewriterProps {
  deletePauseDuration?: number;
  deletingSpeed?: number;
  fontSize?: number;
  pauseDuration?: number;
  sentences: string[];
  typingSpeed?: number;
}

/**
 * Picks a typewriter implementation based on script:
 * - Arabic-script copy → single text node (cursive joining preserved)
 * - otherwise → `@lobehub/ui` TypewriterEffect (per-glyph motion)
 */
const ScriptAwareTypewriter = memo<ScriptAwareTypewriterProps>(
  ({
    sentences,
    fontSize = 24,
    typingSpeed = 32,
    deletingSpeed = 16,
    pauseDuration = 16_000,
    deletePauseDuration = 1000,
  }) => {
    const { i18n } = useTranslation();
    const locale = i18n.language;
    const usePlain = useMemo(
      () => sentences.some((sentence) => textNeedsCursiveJoining(sentence)),
      [sentences],
    );
    const cursorCharacter = <LoadingDots size={fontSize} variant={'pulse'} />;

    if (usePlain) {
      return (
        <PlainTypewriter
          cursorCharacter={cursorCharacter}
          deletePauseDuration={deletePauseDuration}
          deletingSpeed={deletingSpeed}
          hideCursorWhileTyping={'afterTyping'}
          key={locale}
          pauseDuration={pauseDuration}
          sentences={sentences}
          typingSpeed={typingSpeed}
        />
      );
    }

    return (
      <TypewriterEffect
        cursorCharacter={cursorCharacter}
        cursorFade={false}
        deletePauseDuration={deletePauseDuration}
        deletingSpeed={deletingSpeed}
        hideCursorWhileTyping={'afterTyping'}
        key={locale}
        pauseDuration={pauseDuration}
        sentences={sentences}
        typingSpeed={typingSpeed}
      />
    );
  },
);

ScriptAwareTypewriter.displayName = 'ScriptAwareTypewriter';

export default ScriptAwareTypewriter;
