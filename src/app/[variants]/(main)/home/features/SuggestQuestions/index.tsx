'use client';

import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Lightbulb, RefreshCw } from 'lucide-react';
import { Suspense, memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { StarterMode } from '@/store/home';

import GroupBlock from '../components/GroupBlock';
import List from './List';
import SuggestQuestionsSkeleton from './Skeleton';
import { useRandomQuestions } from './useRandomQuestions';

interface SuggestQuestionsProps {
  mode: StarterMode;
}

const SuggestQuestions = memo<SuggestQuestionsProps>(({ mode }) => {
  const { t } = useTranslation('common');
  const { questions, refresh } = useRandomQuestions(mode);

  if (!mode || !['agent', 'group', 'write'].includes(mode)) {
    return null;
  }

  return (
    <GroupBlock
      action={
        <Flexbox
          align={'center'}
          gap={4}
          horizontal
          onClick={refresh}
          style={{ cursor: 'pointer' }}
        >
          <ActionIcon icon={RefreshCw} size={'small'} />
          <Text color={cssVar.colorTextSecondary} fontSize={12}>
            {t('switch')}
          </Text>
        </Flexbox>
      }
      actionAlwaysVisible
      icon={Lightbulb}
      title={t('home.suggestQuestions')}
    >
      <Suspense fallback={<SuggestQuestionsSkeleton />}>
        <List questions={questions} />
      </Suspense>
    </GroupBlock>
  );
});

export default SuggestQuestions;
