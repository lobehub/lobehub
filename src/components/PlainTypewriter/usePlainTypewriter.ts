import { useEffect, useMemo, useState } from 'react';

import { splitGraphemes } from '@/utils/cursiveScript';

export interface UsePlainTypewriterOptions {
  deletePauseDuration?: number;
  deletingSpeed?: number;
  hideCursorWhileTyping?: boolean | 'typing' | 'afterTyping';
  pauseDuration?: number;
  sentences: string[];
  typingSpeed?: number;
}

export interface UsePlainTypewriterResult {
  displayedText: string;
  showCursor: boolean;
}

export const usePlainTypewriter = ({
  sentences,
  typingSpeed = 100,
  deletingSpeed = 50,
  pauseDuration = 2000,
  deletePauseDuration = 0,
  hideCursorWhileTyping = false,
}: UsePlainTypewriterOptions): UsePlainTypewriterResult => {
  const textArray = useMemo(() => sentences, [sentences]);
  const [displayedText, setDisplayedText] = useState('');
  const [charIndex, setCharIndex] = useState(0);
  const [textIndex, setTextIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeletePausing, setIsDeletePausing] = useState(false);

  useEffect(() => {
    const current = textArray[textIndex] ?? '';
    const segments = splitGraphemes(current);
    let timeout: ReturnType<typeof setTimeout>;

    if (isDeletePausing) {
      timeout = setTimeout(() => setIsDeletePausing(false), deletePauseDuration);
      return () => clearTimeout(timeout);
    }

    if (isDeleting) {
      if (displayedText === '') {
        setIsDeleting(false);
        setTextIndex((prev) => (prev + 1) % textArray.length);
        setCharIndex(0);
        if (deletePauseDuration > 0) setIsDeletePausing(true);
        return;
      }

      timeout = setTimeout(() => {
        setDisplayedText(splitGraphemes(displayedText).slice(0, -1).join(''));
      }, deletingSpeed);
      return () => clearTimeout(timeout);
    }

    if (charIndex < segments.length) {
      timeout = setTimeout(() => {
        setDisplayedText(segments.slice(0, charIndex + 1).join(''));
        setCharIndex((prev) => prev + 1);
      }, typingSpeed);
      return () => clearTimeout(timeout);
    }

    timeout = setTimeout(() => setIsDeleting(true), pauseDuration);
    return () => clearTimeout(timeout);
  }, [
    charIndex,
    deletePauseDuration,
    deletingSpeed,
    displayedText,
    isDeletePausing,
    isDeleting,
    pauseDuration,
    textArray,
    textIndex,
    typingSpeed,
  ]);

  const currentLength = splitGraphemes(textArray[textIndex] ?? '').length;
  const isTyping = charIndex < currentLength && !isDeleting;
  const isAfterTyping = charIndex === currentLength && !isDeleting;
  const showCursor = !(
    hideCursorWhileTyping === true ||
    (hideCursorWhileTyping === 'typing' && (isTyping || isDeleting)) ||
    (hideCursorWhileTyping === 'afterTyping' && isAfterTyping)
  );

  return { displayedText, showCursor };
};
