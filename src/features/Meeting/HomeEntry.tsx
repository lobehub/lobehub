'use client';

import { ActionIcon, Button, Flexbox, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { AudioLinesIcon, NotebookTextIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { meetingActions, meetingSelectors, useMeetingStore } from '@/store/meeting';

import { formatClock } from './format';
import { MEETING_LIST_PATH } from './paths';

const styles = stylex.create({
  recording: {
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorError,
  },
});

const RecordingLabel = () => {
  const { t } = useTranslation('meeting');
  const durationMs = useMeetingStore((s) => s.recorder.durationMs);
  const paused = useMeetingStore((s) => s.recorder.phase === 'paused');
  return <>{t(paused ? 'entry.paused' : 'entry.recording', { time: formatClock(durationMs) })}</>;
};

/**
 * Home's one-click way into meeting notes: opens the floating recorder, or
 * brings back the one already recording. The icon next to it opens the list.
 */
const MeetingHomeEntry = () => {
  const { t } = useTranslation('meeting');
  const navigate = useWorkspaceAwareNavigate();
  const busy = useMeetingStore(meetingSelectors.isRecorderBusy);

  return (
    <Flexbox horizontal align={'center'} gap={4}>
      <Tooltip title={busy ? undefined : t('entry.tooltip')}>
        <Button
          className={stylex.props(busy && styles.recording).className}
          data-testid={'meeting-home-entry'}
          icon={AudioLinesIcon}
          size={'small'}
          onClick={meetingActions.openRecorder}
        >
          {busy ? <RecordingLabel /> : t('entry.record')}
        </Button>
      </Tooltip>
      <ActionIcon
        aria-label={t('entry.notes')}
        icon={NotebookTextIcon}
        size={'small'}
        title={t('entry.notes')}
        onClick={() => navigate(MEETING_LIST_PATH)}
      />
    </Flexbox>
  );
};

export default MeetingHomeEntry;
