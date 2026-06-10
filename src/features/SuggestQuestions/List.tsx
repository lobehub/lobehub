'use client';

import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { RefreshCw } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Item from './Item';
import { type SuggestMode } from './useRandomQuestions';
import { useRandomQuestions } from './useRandomQuestions';

interface ListProps {
  count?: number;
  disabled?: boolean;
  mode: SuggestMode;
}

const List = memo<ListProps>(({ mode, count = 3, disabled }) => {
  const { t } = useTranslation('suggestQuestions');
  const { t: tCommon } = useTranslation('common');
  const { questions, refresh } = useRandomQuestions(mode, count);

  if (questions.length === 0) {
    return null;
  }

  return (
    <Flexbox gap={12}>
      <Flexbox gap={8}>
        {questions.map((item) => {
          const prompt = t(item.promptKey as any);
          return (
            <Item
              description={prompt}
              disabled={disabled}
              key={item.id}
              prompt={prompt}
              title={t(item.titleKey as any)}
            />
          );
        })}
      </Flexbox>
      <Flexbox
        horizontal
        align={'center'}
        gap={4}
        style={{
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.65 : undefined,
        }}
        onClick={() => {
          if (disabled) return;

          refresh();
        }}
      >
        <ActionIcon disabled={disabled} icon={RefreshCw} size={'small'} />
        <Text color={cssVar.colorTextSecondary} fontSize={12}>
          {tCommon('switch')}
        </Text>
      </Flexbox>
    </Flexbox>
  );
});

export default List;
