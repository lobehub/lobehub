'use client';

import { useCallback, useState } from 'react';

const QUESTION_COUNT = 40;

const shuffleArray = <T>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

const generateQuestions = (mode: string, count: number) => {
  const ids = Array.from({ length: QUESTION_COUNT }, (_, i) => i + 1);
  const shuffled = shuffleArray(ids);
  return shuffled.slice(0, count).map((id) => ({
    id,
    promptKey: `${mode}.${String(id).padStart(2, '0')}.prompt`,
    titleKey: `${mode}.${String(id).padStart(2, '0')}.title`,
  }));
};

export interface QuestionItem {
  id: number;
  promptKey: string;
  titleKey: string;
}

export type SuggestMode = 'agent' | 'group' | 'write';

export const useRandomQuestions = (
  mode: SuggestMode,
  count: number = 3,
): {
  questions: QuestionItem[];
  refresh: () => void;
} => {
  const [questions, setQuestions] = useState<QuestionItem[]>(() => generateQuestions(mode, count));

  const refresh = useCallback(() => {
    setQuestions(generateQuestions(mode, count));
  }, [mode, count]);

  return { questions, refresh };
};
