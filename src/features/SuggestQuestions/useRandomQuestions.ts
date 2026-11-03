'use client';

import { useCallback, useState } from 'react';

export type SuggestMode = 'agent' | 'group' | 'write' | 'agentBuilder' | 'groupBuilder';

/**
 * Size of the question pool each mode can draw from. The keys in the
 * `suggestQuestions` locale namespace are `${mode}.${id}.{prompt,title}`,
 * so this must stay in sync with how many questions exist per mode —
 * otherwise the shuffle would reference missing translation keys.
 *
 * The builder modes use a smaller, curated pool of build/configure-oriented
 * starters instead of the generic end-user chat topics.
 */
const QUESTION_POOL_SIZE: Record<SuggestMode, number> = {
  agent: 40,
  agentBuilder: 12,
  group: 40,
  groupBuilder: 12,
  write: 40,
};

const shuffleArray = <T>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

const generateQuestions = (mode: SuggestMode, count: number) => {
  const poolSize = QUESTION_POOL_SIZE[mode];
  const ids = Array.from({ length: poolSize }, (_, i) => i + 1);
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
