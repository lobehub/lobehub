import type { MeetingActionItem } from '@lobechat/types';
import { Button, Flexbox, Icon, Markdown, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  BookmarkIcon,
  CircleCheckIcon,
  ListTodoIcon,
  PlayIcon,
  RefreshCwIcon,
  SparklesIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { type MeetingDetail, meetingService } from '@/services/meeting';
import { isMeetingProcessing, meetingActions } from '@/store/meeting';

import { formatClock } from '../format';
import ActionItems from './ActionItems';
import { minutesLists } from './normalize';

const styles = stylex.create({
  cite: {
    cursor: 'pointer',
    display: 'inline-flex',
    flex: 'none',
    gap: 2,
    alignItems: 'center',
    paddingBlock: 0,
    paddingInline: 0,
    borderStyle: 'none',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorPrimary },
    whiteSpace: 'nowrap',
  },
  item: {
    paddingBlockStart: { 'default': 12, ':first-child': 0 },
    paddingBlockEnd: 12,
    borderBlockStartWidth: { 'default': 1, ':first-child': 0 },
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  section: {
    padding: 16,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
  },
});

interface MinutesProps {
  meeting: Pick<MeetingDetail, 'error' | 'id' | 'minutes' | 'status'>;
  onSeek: (ms: number) => void;
  /** Start offset of each transcript segment, for the citations. */
  segmentStarts: Map<string, number>;
  /** Shown name of each diarization label, for owners the minutes name by label. */
  speakerNameByLabel: Map<string, string>;
}

const Section = ({
  children,
  icon,
  testId,
  title,
}: {
  children: ReactNode;
  icon: typeof SparklesIcon;
  testId: string;
  title: string;
}) => (
  <Flexbox className={stylex.props(styles.section).className} data-testid={testId} gap={12}>
    <Flexbox horizontal align={'center'} gap={8}>
      <Icon color={cssVar.colorTextSecondary} icon={icon} size={16} />
      <Text weight={600}>{title}</Text>
    </Flexbox>
    {children}
  </Flexbox>
);

const Citation = ({
  fallbackMs,
  onSeek,
  segmentIds,
  segmentStarts,
}: {
  /** Stored offset of the source, used when its segments were replaced by a later refine. */
  fallbackMs?: number;
  onSeek: (ms: number) => void;
  segmentIds: string[];
  segmentStarts: Map<string, number>;
}) => {
  const { t } = useTranslation('meeting');
  const starts = segmentIds
    .map((id) => segmentStarts.get(id))
    .filter((ms): ms is number => ms !== undefined);
  if (starts.length === 0 && fallbackMs === undefined) return null;

  const first = starts.length > 0 ? Math.min(...starts) : fallbackMs!;
  return (
    <button
      className={stylex.props(styles.cite).className}
      type={'button'}
      onClick={() => onSeek(first)}
    >
      <Icon icon={PlayIcon} size={12} />
      {t('minutes.jumpTo', { time: formatClock(first) })}
    </button>
  );
};

const Minutes = ({ meeting, onSeek, segmentStarts, speakerNameByLabel }: MinutesProps) => {
  const { t } = useTranslation('meeting');
  const [generating, setGenerating] = useState(false);
  const { minutes } = meeting;
  const empty = <Text type={'secondary'}>{t('minutes.empty')}</Text>;
  const minutesError = meeting.error?.stage === 'minutes' ? meeting.error : undefined;

  const generate = async () => {
    setGenerating(true);
    try {
      await meetingService.generateMinutes(meeting.id);
    } finally {
      await meetingActions.refreshMeetingDetail(meeting.id).catch(() => undefined);
      setGenerating(false);
    }
  };

  const regenerate = (
    <Button icon={RefreshCwIcon} loading={generating} onClick={() => void generate()}>
      {minutes ? t('minutes.regenerate') : t('minutes.generate')}
    </Button>
  );

  const errorAlert = minutesError && (
    <AsyncError
      action={regenerate}
      justify={'start'}
      title={t('minutes.error.title')}
      variant={'inline'}
      description={t(`minutes.error.${minutesError.code}`, {
        defaultValue: t('minutes.error.summarization_failed'),
      })}
    />
  );

  if (!minutes) {
    const busy = meeting.status === 'summarizing' || generating;
    return (
      <Section icon={SparklesIcon} testId={'meeting-minutes'} title={t('minutes.title')}>
        {errorAlert ??
          (busy ? (
            <Text type={'secondary'}>{t('minutes.generating')}</Text>
          ) : isMeetingProcessing(meeting.status) ? (
            <Text type={'secondary'}>{t('minutes.pending')}</Text>
          ) : (
            <Flexbox align={'flex-start'} gap={8}>
              <Text type={'secondary'}>{t('minutes.notGenerated')}</Text>
              {regenerate}
            </Flexbox>
          ))}
      </Section>
    );
  }

  const { actionItems, chapters, decisions, keywords } = minutesLists(minutes);

  const citation = (item: Pick<MeetingActionItem, 'segmentIds' | 'startMs'>) => (
    <Citation
      fallbackMs={item.startMs}
      segmentIds={item.segmentIds}
      segmentStarts={segmentStarts}
      onSeek={onSeek}
    />
  );

  return (
    <Flexbox gap={12}>
      {errorAlert}
      {meeting.status === 'summarizing' && (
        <Text fontSize={12} type={'secondary'}>
          {t('minutes.generating')}
        </Text>
      )}
      <Section icon={SparklesIcon} testId={'meeting-minutes-summary'} title={t('minutes.summary')}>
        {minutes.summary ? (
          <Markdown fontSize={14} variant={'chat'}>
            {minutes.summary}
          </Markdown>
        ) : (
          empty
        )}
        {keywords.length > 0 && (
          <Flexbox horizontal gap={6} wrap={'wrap'}>
            {keywords.map((keyword) => (
              <Tag key={keyword} size={'small'}>
                {keyword}
              </Tag>
            ))}
          </Flexbox>
        )}
        {!minutesError && (
          <Flexbox horizontal justify={'flex-end'}>
            {regenerate}
          </Flexbox>
        )}
      </Section>
      <Section
        icon={BookmarkIcon}
        testId={'meeting-minutes-chapters'}
        title={t('minutes.chapters')}
      >
        {chapters.length === 0
          ? empty
          : chapters.map((chapter, index) => (
              <Flexbox
                horizontal
                align={'baseline'}
                className={stylex.props(styles.item).className}
                gap={8}
                key={index}
              >
                <button
                  className={stylex.props(styles.cite).className}
                  type={'button'}
                  onClick={() => onSeek(chapter.startMs)}
                >
                  <Icon icon={PlayIcon} size={12} />
                  {formatClock(chapter.startMs)}
                </button>
                <Text>{chapter.title}</Text>
              </Flexbox>
            ))}
      </Section>
      <Section
        icon={CircleCheckIcon}
        testId={'meeting-minutes-decisions'}
        title={t('minutes.decisions')}
      >
        {decisions.length === 0
          ? empty
          : decisions.map((decision, index) => (
              <Flexbox className={stylex.props(styles.item).className} gap={4} key={index}>
                <Text>{decision.text}</Text>
                {citation(decision)}
              </Flexbox>
            ))}
      </Section>
      <Section
        icon={ListTodoIcon}
        testId={'meeting-minutes-action-items'}
        title={t('minutes.actionItems')}
      >
        <ActionItems
          items={actionItems}
          meetingId={meeting.id}
          renderCitation={citation}
          speakerNameByLabel={speakerNameByLabel}
        />
      </Section>
    </Flexbox>
  );
};

export default Minutes;
