'use client';

import type { MeetingSegmentSource } from '@lobechat/types';
import { Alert, Block, Empty, Flexbox, Segmented, SkeletonText, Text } from '@lobehub/ui';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { meetingService } from '@/services/meeting';

import { formatOffset } from '../format';
import RefineErrorAlert from '../RefineErrorAlert';
import SegmentList from '../SegmentList';
import { toTranscriptSegments } from './segments';

/** Statuses during which the server is still producing the transcript. */
const IN_PROGRESS = new Set(['uploading', 'transcribing']);

interface MeetingTranscriptProps {
  meetingId: string;
}

/** A meeting's transcript: refined with speakers once ready, the live draft until then. */
const MeetingTranscript = ({ meetingId }: MeetingTranscriptProps) => {
  const { t } = useTranslation('meeting');
  const audioRef = useRef<HTMLAudioElement>(null);
  const [source, setSource] = useState<MeetingSegmentSource>();
  const [retrying, setRetrying] = useState(false);

  const { data, isLoading, mutate } = useClientDataSWR(
    ['meeting-detail', meetingId, source],
    () => meetingService.detail(meetingId, source),
    {
      refreshInterval: (latest?: { status?: string }) =>
        latest?.status && IN_PROGRESS.has(latest.status) ? 3000 : 0,
    },
  );

  if (isLoading && !data) {
    return (
      <Flexbox gap={16} padding={24} style={{ marginInline: 'auto', maxWidth: 880, width: '100%' }}>
        <SkeletonText rows={8} />
      </Flexbox>
    );
  }
  if (!data) return <Empty description={t('transcript.notFound')} />;

  const segments = toTranscriptSegments(data);
  const speakerCount = new Set(segments.map((segment) => segment.speaker).filter(Boolean)).size;

  const retry = async () => {
    setRetrying(true);
    try {
      await meetingService.refine(meetingId);
    } finally {
      setRetrying(false);
      await mutate();
    }
  };

  const seek = (ms: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = ms / 1000;
    void audio.play();
  };

  return (
    <Flexbox gap={16} padding={24} style={{ marginInline: 'auto', maxWidth: 880, width: '100%' }}>
      <Flexbox gap={4}>
        <Text as={'h1'} fontSize={20} weight={600}>
          {data.title}
        </Text>
        <Text data-testid="meeting-transcript-meta" type={'secondary'}>
          {[
            formatOffset(data.durationMs ?? 0),
            t('transcript.segments', { count: segments.length, speakers: speakerCount }),
          ].join(' · ')}
        </Text>
      </Flexbox>

      {data.status === 'failed' && data.error && (
        <RefineErrorAlert code={data.error.code} loading={retrying} onRetry={retry} />
      )}
      {(IN_PROGRESS.has(data.status) || retrying) && (
        <Alert
          showIcon
          description={t('refine.running')}
          title={t('recorder.status.refining')}
          type={'info'}
        />
      )}

      {data.audio?.url && (
        <audio controls ref={audioRef} src={data.audio.url} style={{ width: '100%' }} />
      )}

      <Block gap={12} padding={16} variant={'outlined'}>
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <Text weight={600}>{t('transcript.title')}</Text>
          <Segmented
            size={'small'}
            value={data.segmentSource}
            options={[
              { label: t('transcript.source.refine'), value: 'refine' },
              { label: t('transcript.source.realtime'), value: 'realtime' },
            ]}
            onChange={(value) => setSource(value as MeetingSegmentSource)}
          />
        </Flexbox>
        {data.segmentSource === 'realtime' && data.status !== 'ready' && (
          <Text fontSize={12} type={'secondary'}>
            {t('transcript.draftNotice')}
          </Text>
        )}
        {segments.length === 0 ? (
          <Text type={'secondary'}>{t('transcript.empty')}</Text>
        ) : (
          <SegmentList segments={segments} onSeek={data.audio?.url ? seek : undefined} />
        )}
      </Block>
    </Flexbox>
  );
};

export default MeetingTranscript;
