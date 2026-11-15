'use client';

import { Alert, Block, Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { MicIcon, PauseIcon, PlayIcon, SquareIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { formatOffset } from '../format';
import RefineErrorAlert from '../RefineErrorAlert';
import SegmentList from '../SegmentList';
import { useMeetingRecorder } from '../useMeetingRecorder';
import LiveStatusAlert from './LiveStatusAlert';

const styles = stylex.create({
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
  },
  timer: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 28,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1,
  },
});

const POST_PHASES = new Set(['finishing', 'uploading', 'refining']);

/** Record a meeting and watch its live transcript; ends in the refined transcript. */
const RecorderPanel = () => {
  const { t } = useTranslation('meeting');
  const navigate = useWorkspaceAwareNavigate();
  const { recorder, snapshot } = useMeetingRecorder();
  const { error, live, meetingId, phase, refine } = snapshot;

  const live_ = phase === 'recording' || phase === 'paused';
  const start = () =>
    recorder.start({
      title: t('recorder.defaultTitle', { date: dayjs().format('YYYY-MM-DD HH:mm') }),
    });
  const openTranscript = () => meetingId && navigate(`/meeting/${meetingId}`);

  /** One action group per phase: start, the live controls, or what to do after stopping. */
  let actions: ReactNode = null;
  if (phase === 'idle' || phase === 'requesting_permission') {
    actions = (
      <Button
        icon={<Icon icon={MicIcon} />}
        loading={phase === 'requesting_permission'}
        type={'primary'}
        onClick={start}
      >
        {t('recorder.start')}
      </Button>
    );
  } else if (live_) {
    actions = (
      <>
        {phase === 'recording' ? (
          <Button icon={<Icon icon={PauseIcon} />} onClick={recorder.pause}>
            {t('recorder.pause')}
          </Button>
        ) : (
          <Button icon={<Icon icon={PlayIcon} />} onClick={recorder.resume}>
            {t('recorder.resume')}
          </Button>
        )}
        <Button danger icon={<Icon icon={SquareIcon} />} onClick={recorder.stop}>
          {t('recorder.stop')}
        </Button>
      </>
    );
  } else if (phase === 'done') {
    actions = (
      <>
        <Button onClick={recorder.reset}>{t('recorder.newMeeting')}</Button>
        <Button type={'primary'} onClick={openTranscript}>
          {t('recorder.openTranscript')}
        </Button>
      </>
    );
  }

  return (
    <Flexbox gap={16} padding={24} style={{ marginInline: 'auto', maxWidth: 880, width: '100%' }}>
      <Flexbox gap={4}>
        <Text as={'h1'} fontSize={20} weight={600}>
          {t('recorder.title')}
        </Text>
        <Text type={'secondary'}>{t('recorder.desc')}</Text>
      </Flexbox>

      <Block
        horizontal
        align={'center'}
        gap={16}
        justify={'space-between'}
        padding={16}
        variant={'outlined'}
      >
        <Flexbox gap={8}>
          <Flexbox horizontal align={'center'} gap={8}>
            <span
              className={stylex.props(styles.dot).className}
              style={{
                background:
                  phase === 'recording'
                    ? cssVar.colorError
                    : phase === 'paused'
                      ? cssVar.colorWarning
                      : cssVar.colorTextQuaternary,
                opacity: phase === 'recording' ? 0.4 + Math.min(snapshot.level * 12, 0.6) : 1,
              }}
            />
            <Text data-testid="meeting-recorder-status" type={'secondary'}>
              {t(`recorder.status.${phase}`)}
            </Text>
          </Flexbox>
          <span
            className={stylex.props(styles.timer).className}
            data-testid="meeting-recorder-timer"
          >
            {formatOffset(snapshot.durationMs)}
          </span>
        </Flexbox>

        <Flexbox horizontal gap={8}>
          {actions}
        </Flexbox>
      </Block>

      {error && (
        <div data-testid="meeting-recorder-error">
          <AsyncError
            description={t(`error.${error}.desc`)}
            justify={'start'}
            title={t(`error.${error}.title`)}
            variant={'inline'}
            action={
              error === 'upload_failed' ? (
                <Button onClick={recorder.retryProcessing}>{t('live.retryNow')}</Button>
              ) : phase === 'idle' ? (
                <Button onClick={start}>{t('live.retryNow')}</Button>
              ) : undefined
            }
          />
        </div>
      )}

      {(live_ || phase === 'finishing') && (
        <LiveStatusAlert live={live} onRetry={recorder.retryLive} />
      )}

      {POST_PHASES.has(phase) && error !== 'upload_failed' && (
        <Alert
          showIcon
          data-testid="meeting-recorder-progress"
          description={phase === 'refining' ? t('refine.running') : undefined}
          title={t(`recorder.status.${phase}`)}
          type={'info'}
        />
      )}

      {phase === 'done' && refine?.status === 'ready' && (
        <Alert
          data-testid="meeting-refine-ready"
          title={t('recorder.refineReady')}
          type={'success'}
        />
      )}
      {phase === 'done' && refine?.status === 'failed' && refine.errorCode && (
        <RefineErrorAlert code={refine.errorCode} onRetry={recorder.retryProcessing} />
      )}

      <Block gap={12} padding={16} variant={'outlined'}>
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <Text weight={600}>{t('live.title')}</Text>
          {live.pendingMs >= 30_000 && live.state === 'live' && (
            <Text fontSize={12} type={'secondary'}>
              {t('live.catchingUp', { seconds: Math.round(live.pendingMs / 1000) })}
            </Text>
          )}
        </Flexbox>
        {live.mode === 'window' && (
          <Text fontSize={12} type={'secondary'}>
            {t('live.windowMode')}
          </Text>
        )}
        {snapshot.segments.length === 0 && !snapshot.tail ? (
          <Text type={'secondary'}>{t('live.empty')}</Text>
        ) : (
          <SegmentList segments={snapshot.segments} tail={snapshot.tail} />
        )}
      </Block>
    </Flexbox>
  );
};

export default RecorderPanel;
