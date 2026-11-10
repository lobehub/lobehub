'use client';

import { Block, Button, Flexbox, Icon, Switch, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { ChevronLeftIcon, RefreshCwIcon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import NavHeader from '@/features/NavHeader';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { type MeetingDetail, meetingService } from '@/services/meeting';
import {
  isMeetingProcessing,
  meetingActions,
  meetingSelectors,
  useMeetingStore,
} from '@/store/meeting';
import { isTrpcErrorCode } from '@/utils/trpcError';

import { findActiveSegment, formatClock } from '../format';
import { MEETING_LIST_PATH } from '../paths';
import MeetingStatusTag from '../StatusTag';
import AudioPlayer from './AudioPlayer';
import Minutes from './Minutes';
import { transcriptLists } from './normalize';
import { buildSpeakerViews } from './speakers';
import Transcript from './Transcript';
import { usePlayback } from './usePlayback';

const DetailSkeleton = createSurfaceSkeleton('detail');

const styles = stylex.create({
  body: {
    overflowX: 'hidden',
    overflowY: { 'default': 'hidden', '@media (max-width: 960px)': 'auto' },
    display: 'grid',
    gridTemplateColumns: {
      'default': 'minmax(0, 1fr) 380px',
      '@media (max-width: 960px)': 'minmax(0, 1fr)',
    },
    flex: '1',
    minHeight: 0,
  },
  breadcrumb: {
    cursor: 'pointer',
    display: 'inline-flex',
    gap: 2,
    alignItems: 'center',
    paddingBlock: 0,
    paddingInline: 0,
    borderStyle: 'none',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    fontSize: 14,
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
  },
  meta: {
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorTextTertiary,
  },
  side: {
    overflowY: { 'default': 'auto', '@media (max-width: 960px)': 'visible' },
    padding: 16,
    borderInlineStartWidth: { 'default': 1, '@media (max-width: 960px)': 0 },
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorderSecondary,
  },
  transcript: {
    overflowY: { 'default': 'auto', '@media (max-width: 960px)': 'visible' },
    paddingBlockStart: 0,
    paddingBlockEnd: 24,
    paddingInline: 16,
  },
  transcriptHeader: {
    position: 'sticky',
    zIndex: 1,
    insetBlockStart: 0,
    paddingBlockStart: 16,
    paddingBlockEnd: 12,
    backgroundColor: cssVar.colorBgContainer,
  },
});

const MeetingBody = ({ meeting }: { meeting: MeetingDetail }) => {
  const { t } = useTranslation('meeting');
  const playback = usePlayback(meeting.durationMs);
  const [follow, setFollow] = useState(true);
  const { seek } = playback;
  const { segments, speakers: speakerList } = transcriptLists(meeting);

  const speakers = useMemo(
    () => buildSpeakerViews(speakerList, (index) => t('detail.transcript.speaker', { index })),
    [speakerList, t],
  );
  const segmentStarts = useMemo(
    () => new Map(segments.map((segment) => [segment.id, segment.startMs])),
    [segments],
  );
  const activeIndex = findActiveSegment(segments, playback.currentMs);
  const onSeek = useCallback((ms: number) => seek(ms), [seek]);
  const meetingId = meeting.id;
  const onRenameSpeaker = useCallback(
    async (speakerId: string, name: string) => {
      await meetingService.renameSpeaker(meetingId, speakerId, name);
      await meetingActions.refreshMeetingDetail(meetingId);
    },
    [meetingId],
  );
  /** Diarization label ("S3") → the name shown for that speaker ("发言人 3", or the given name). */
  const speakerNameByLabel = useMemo(
    () =>
      new Map(
        speakerList.flatMap((speaker) => {
          const view = speakers.get(speaker.id);
          return view ? [[speaker.label, view.name] as const] : [];
        }),
      ),
    [speakerList, speakers],
  );

  const processing = isMeetingProcessing(meeting.status);
  const isDraft = meeting.segmentSource === 'realtime' && segments.length > 0;
  const audioHint = meeting.localAudioPath ? t('audio.local') : t('audio.unavailable');

  return (
    <div className={stylex.props(styles.body).className}>
      <div className={stylex.props(styles.transcript).className}>
        <Flexbox className={stylex.props(styles.transcriptHeader).className} gap={12}>
          <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
            <Flexbox gap={2}>
              <Text fontSize={20} weight={600}>
                {meeting.title}
              </Text>
              <span className={stylex.props(styles.meta).className}>
                {t('meta.startedAt')} {dayjs(meeting.startedAt).format('YYYY-MM-DD HH:mm')}
                {meeting.durationMs
                  ? ` · ${t('meta.duration')} ${formatClock(meeting.durationMs)}`
                  : ''}
              </span>
            </Flexbox>
            <Flexbox horizontal align={'center'} gap={6}>
              <Text fontSize={12} type={'secondary'}>
                {t('detail.followPlayback')}
              </Text>
              <Switch checked={follow} size={'small'} onChange={setFollow} />
            </Flexbox>
          </Flexbox>
          <AudioPlayer emptyHint={audioHint} playback={playback} src={meeting.audio?.url} />
          <Flexbox horizontal align={'center'} gap={8}>
            <Text weight={600}>{t('detail.transcript.title')}</Text>
            {isDraft && (
              <Text fontSize={12} type={'secondary'}>
                {t('detail.transcript.draftHint')}
              </Text>
            )}
          </Flexbox>
        </Flexbox>
        <Transcript
          activeIndex={activeIndex}
          follow={follow && playback.playing}
          renameLabel={t('detail.transcript.renameSpeaker')}
          segments={segments}
          speakers={speakers}
          unknownSpeaker={t('detail.transcript.unknownSpeaker')}
          emptyText={
            processing ? t('detail.transcript.emptyProcessing') : t('detail.transcript.empty')
          }
          onRenameSpeaker={onRenameSpeaker}
          onSeek={onSeek}
        />
      </div>
      <div className={stylex.props(styles.side).className}>
        <Minutes
          meeting={meeting}
          segmentStarts={segmentStarts}
          speakerNameByLabel={speakerNameByLabel}
          onSeek={onSeek}
        />
      </div>
    </div>
  );
};

const MeetingDetailPage = ({ meetingId }: { meetingId: string }) => {
  const { t } = useTranslation('meeting');
  const navigate = useWorkspaceAwareNavigate();
  const { error } = meetingActions.useFetchMeetingDetail(meetingId);
  const meeting = useMeetingStore(meetingSelectors.meetingDetail(meetingId));

  const notFound = !meeting && isTrpcErrorCode(error, 'NOT_FOUND');

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <NavHeader
        right={meeting ? <MeetingStatusTag status={meeting.status} /> : undefined}
        left={
          <Flexbox horizontal align={'center'} gap={6}>
            <button
              className={stylex.props(styles.breadcrumb).className}
              type={'button'}
              onClick={() => navigate(MEETING_LIST_PATH)}
            >
              <Icon icon={ChevronLeftIcon} size={16} />
              {t('detail.back')}
            </button>
          </Flexbox>
        }
      />
      {meeting ? (
        <MeetingBody meeting={meeting} />
      ) : notFound ? (
        <Flexbox align={'center'} padding={48}>
          <Block padding={32} variant={'outlined'}>
            <Flexbox align={'center'} gap={8}>
              <Text weight={600}>{t('detail.notFound.title')}</Text>
              <Text fontSize={13} type={'secondary'}>
                {t('detail.notFound.description')}
              </Text>
            </Flexbox>
          </Block>
        </Flexbox>
      ) : error ? (
        <Flexbox align={'center'} padding={48}>
          <Block padding={32} variant={'outlined'}>
            <Flexbox align={'center'} gap={12}>
              <Text weight={600}>{t('detail.loadError')}</Text>
              <Button
                icon={RefreshCwIcon}
                onClick={() => void meetingActions.refreshMeetingDetail(meetingId)}
              >
                {t('list.retry')}
              </Button>
            </Flexbox>
          </Block>
        </Flexbox>
      ) : (
        <DetailSkeleton chrome={'body'} />
      )}
    </Flexbox>
  );
};

export default MeetingDetailPage;
