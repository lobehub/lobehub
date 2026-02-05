import { useCallback, useState } from 'react';

import { type StarterMode } from '@/store/home';

const QUESTION_COUNT = 40;
const DISPLAY_COUNT = 6;

const shuffleArray = <T>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

const generateQuestions = (mode: StarterMode) => {
  if (!mode || !['agent', 'group', 'write'].includes(mode)) {
    return [];
  }

  const ids = Array.from({ length: QUESTION_COUNT }, (_, i) => i + 1);
  const shuffled = shuffleArray(ids);
  return shuffled.slice(0, DISPLAY_COUNT).map((id) => ({
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

interface UseRandomQuestionsResult {
  questions: QuestionItem[];
  refresh: () => void;
}

export const useRandomQuestions = (mode: StarterMode): UseRandomQuestionsResult => {
  const [questions, setQuestions] = useState<QuestionItem[]>(() => generateQuestions(mode));

  const refresh = useCallback(() => {
    setQuestions(generateQuestions(mode));
  }, [mode]);

  return { questions, refresh };
};
