import { Text } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { oneLineEllipsis } from '@/styles';

import { useReportChapter, useReportGraph } from './useReportGraph';

const TitleText = ({ children }: { children: string }) => (
  <Text className={oneLineEllipsis} style={{ flex: '0 1 auto', fontSize: 14, minWidth: 0 }}>
    {children}
  </Text>
);

export const ReportTitle = memo(() => {
  const { t } = useTranslation('chat');
  return <TitleText>{t('goalProcess.result.story.reportTitle')}</TitleText>;
});

ReportTitle.displayName = 'GoalReportTitle';

export const ChapterTitle = memo(() => {
  const { t } = useTranslation('chat');
  const view = useChatStore(chatPortalSelectors.goalReportChapterView);
  const { graph, story } = useReportGraph(view?.goalId);
  const chapter = useReportChapter(graph, story, view?.chapterIndex);

  return (
    <TitleText>
      {chapter
        ? `${t('goalProcess.result.story.mapTitle')} · ${chapter.chapter.title}`
        : t('goalProcess.result.story.mapTitle')}
    </TitleText>
  );
});

ChapterTitle.displayName = 'GoalReportChapterTitle';
