'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Item from './Item';
import { type QuestionItem } from './useRandomQuestions';

interface ListProps {
  questions: QuestionItem[];
}

const List = memo<ListProps>(({ questions }) => {
  const { t } = useTranslation('suggestQuestions');

  if (questions.length === 0) {
    return null;
  }

  return (
    <Flexbox gap={12} style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)' }}>
      {questions.map((item) => {
        const prompt = t(item.promptKey as any);
        return (
          <Item
            description={prompt}
            key={item.id}
            prompt={prompt}
            title={t(item.titleKey as any)}
          />
        );
      })}
    </Flexbox>
  );
});

export default List;
