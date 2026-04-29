'use client';

import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Lightbulb, RefreshCw } from 'lucide-react';
import { memo, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

import GroupBlock from '../components/GroupBlock';
import List from './List';
import SuggestQuestionsSkeleton from './Skeleton';
import { useRandomQuestions } from './useRandomQuestions';

const SuggestQuestions = memo(() => {
  const { t } = useTranslation('common');
  const { enableAgentTask } = useServerConfigStore(featureFlagsSelectors);
  const { questions, refresh } = useRandomQuestions();

  if (enableAgentTask) return null;

  return (
    <GroupBlock
      actionAlwaysVisible
      icon={Lightbulb}
      title={t('home.suggestQuestions')}
      action={
        <Flexbox
          horizontal
          align={'center'}
          gap={4}
          style={{ cursor: 'pointer' }}
          onClick={refresh}
        >
          <ActionIcon icon={RefreshCw} size={'small'} />
          <Text color={cssVar.colorTextSecondary} fontSize={12}>
            {t('switch')}
          </Text>
        </Flexbox>
      }
    >
      <Suspense fallback={<SuggestQuestionsSkeleton />}>
        <List questions={questions} />
      </Suspense>
    </GroupBlock>
  );
});

export default SuggestQuestions;
