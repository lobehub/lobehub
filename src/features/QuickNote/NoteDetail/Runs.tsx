'use client';

import { Accordion, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { QuickNoteItem } from '@/services/quickNote';

import SectionLabel from './SectionLabel';

const Runs = memo<{ run: QuickNoteItem['run'] }>(({ run }) => {
  const { t } = useTranslation('note');

  if (!run) return null;

  return (
    <Accordion
      items={[
        {
          children: (
            <Text color={cssVar.colorTextTertiary} fontSize={12}>
              {[run.kind, run.trigger, run.status].filter(Boolean).join(' · ')}
            </Text>
          ),
          key: 'runs',
          title: <SectionLabel title={t('ai.runs')} />,
        },
      ]}
    />
  );
});

Runs.displayName = 'QuickNoteRuns';

export default Runs;
