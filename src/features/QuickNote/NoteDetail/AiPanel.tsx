'use client';

import { HotkeyEnum } from '@lobechat/const/hotkeys';
import { ActionIcon, Button, cssVar, Flexbox, Markdown, Tag, Text, Tooltip } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { PanelRightClose, Sparkles } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { quickNoteSelectors, useQuickNoteStore } from '@/store/quickNote';
import type { QuickNoteSummaryState } from '@/store/quickNote/selectors';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import { formatNoteTime } from '../utils';
import AgenticSections from './AgenticSections';
import AnalyzeAction from './AnalyzeAction';
import AnalyzeSettings from './AnalyzeSettings';
import CommentComposer from './CommentComposer';
import DecisionLine from './DecisionLine';
import type { AiStatus } from './resolveAiStatus';
import { resolveAiStatus } from './resolveAiStatus';
import Runs from './Runs';
import { styles } from './style';
import { useDiveIntoNote } from './useDiveIntoNote';

const STATUS_LABEL_KEYS: Record<AiStatus['key'], string | undefined> = {
  analyzed: 'ai.status.analyzed',
  failed: 'ai.status.failed',
  idle: undefined,
  pending: 'ai.status.pending',
  running: 'ai.status.running',
  scheduled: 'ai.status.scheduled',
};

const SUMMARY_PLACEHOLDER_KEYS = {
  emptyNote: 'summary.emptyNote',
  none: 'summary.none',
  ready: 'summary.waiting',
  waiting: 'summary.waiting',
} as const satisfies Record<QuickNoteSummaryState, string>;

const StatusText = memo<{ noteId: string }>(({ noteId }) => {
  const [now, setNow] = useState(Date.now());
  const status = useQuickNoteStore((s) => {
    const note = quickNoteSelectors.noteById(noteId)(s);
    return note ? resolveAiStatus(note, now) : { key: 'idle' as const };
  }, isEqual);

  useEffect(() => {
    if (status.key !== 'scheduled') return;

    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [status.key]);
  const { t } = useTranslation('note');
  const labelKey = STATUS_LABEL_KEYS[status.key];

  if (!labelKey) return null;

  return (
    <Text color={cssVar.colorTextTertiary} fontSize={12}>
      {t(labelKey as never, {
        seconds: status.seconds,
        time: status.at ? formatNoteTime(status.at) : undefined,
      })}
    </Text>
  );
});

StatusText.displayName = 'QuickNoteAiStatusText';

const AiPanel = memo<{ noteId: string }>(({ noteId }) => {
  const { t } = useTranslation('note');
  const { exists, hasContent, summaryContent, summaryState, tags } = useQuickNoteStore(
    quickNoteSelectors.aiPanelViewById(noteId),
    isEqual,
  );
  const run = useQuickNoteStore(quickNoteSelectors.runById(noteId), isEqual);
  const diving = useQuickNoteStore(quickNoteSelectors.isDiving(noteId));
  const toggleAiPanel = useQuickNoteStore((s) => s.toggleAiPanel);
  const diveIntoNote = useDiveIntoNote(noteId);
  const toggleRightPanelHotkey = useUserStore(
    settingsSelectors.getHotkeyById(HotkeyEnum.ToggleRightPanel),
  );

  if (!exists) return null;

  return (
    <Flexbox height={'100%'} style={{ overflow: 'hidden' }}>
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.columnHeader).className}
        height={44}
        justify={'space-between'}
        paddingInline={16}
      >
        <Flexbox horizontal align={'center'} gap={8}>
          <AnalyzeAction noteId={noteId} />
          <Text weight={500}>{t('ai.title')}</Text>
          <StatusText noteId={noteId} />
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={4}>
          <AnalyzeSettings />
          <ActionIcon
            icon={PanelRightClose}
            title={t('ai.togglePanel')}
            tooltipProps={{ hotkey: toggleRightPanelHotkey }}
            onClick={() => toggleAiPanel(false)}
          />
        </Flexbox>
      </Flexbox>
      <Flexbox flex={1} style={{ overflow: 'hidden' }}>
        <Flexbox flex={1} style={{ overflowY: 'auto' }}>
          <Flexbox className={stylex.props(styles.section).className} gap={8}>
            {summaryContent ? (
              <Markdown fontSize={13} variant={'chat'}>
                {summaryContent}
              </Markdown>
            ) : (
              <Text color={cssVar.colorTextTertiary} fontSize={12}>
                {t(SUMMARY_PLACEHOLDER_KEYS[summaryState])}
              </Text>
            )}
            {run?.decision && <DecisionLine decision={run.decision} />}
            <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
              <Flexbox horizontal gap={6} wrap={'wrap'}>
                {tags.map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </Flexbox>
              <Tooltip title={t('dive.desc')}>
                <Button
                  disabled={!hasContent}
                  icon={Sparkles}
                  loading={diving}
                  style={{ flex: 'none' }}
                  onClick={() => void diveIntoNote()}
                >
                  {t('dive.action')}
                </Button>
              </Tooltip>
            </Flexbox>
          </Flexbox>
          <AgenticSections noteId={noteId} />
          {run && (
            <Flexbox className={stylex.props(styles.section).className} gap={8}>
              <Runs run={run} />
            </Flexbox>
          )}
        </Flexbox>
        <Flexbox flex={'none'} paddingBlock={8} paddingInline={12}>
          <CommentComposer noteId={noteId} />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

AiPanel.displayName = 'QuickNoteAiPanel';

export default AiPanel;
