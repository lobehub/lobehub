'use client';

import { HotkeyEnum } from '@lobechat/const/hotkeys';
import { Flexbox, Markdown } from '@lobehub/ui';
import { ActionIcon, Button, Tag, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { PanelRightClose, Sparkles } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { quickNoteSelectors, useQuickNoteStore } from '@/store/quickNote';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import { formatNoteTime } from '../utils';
import AgenticSections from './AgenticSections';
import AnalyzeAction from './AnalyzeAction';
import AnalyzeSettings from './AnalyzeSettings';
import CommentComposer from './CommentComposer';
import type { AiStatus } from './resolveAiStatus';
import { resolveAiStatus } from './resolveAiStatus';
import Runs from './Runs';
import { styles } from './style';

const STATUS_LABEL_KEYS: Record<AiStatus['key'], string | undefined> = {
  analyzed: 'ai.status.analyzed',
  failed: 'ai.status.failed',
  idle: undefined,
  pending: 'ai.status.pending',
  running: 'ai.status.running',
  scheduled: 'ai.status.scheduled',
};

const StatusText = memo<{ status: AiStatus }>(({ status }) => {
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
  const note = useQuickNoteStore(quickNoteSelectors.noteById(noteId));
  const diving = useQuickNoteStore(quickNoteSelectors.isDiving(noteId));
  const [diveInto, toggleAnnotationPanel] = useQuickNoteStore((s) => [
    s.diveInto,
    s.toggleAnnotationPanel,
  ]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(Date.now());
  const toggleRightPanelHotkey = useUserStore(
    settingsSelectors.getHotkeyById(HotkeyEnum.ToggleRightPanel),
  );

  const status = note ? resolveAiStatus(note, now) : ({ key: 'idle' } as const);
  const annotationContent = note?.annotation?.content;

  useEffect(() => {
    if (status.key !== 'scheduled') return;

    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [status.key]);

  useEffect(() => {
    if (!diving || !bodyRef.current) return;
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [diving, annotationContent]);

  if (!note) return null;

  const dived = Boolean(note.annotation?.divedAt);

  return (
    <Flexbox height={'100%'} style={{ overflow: 'hidden' }}>
      <Flexbox
        horizontal
        align={'center'}
        className={styles.columnHeader}
        height={44}
        justify={'space-between'}
        paddingInline={16}
      >
        <Flexbox horizontal align={'center'} gap={8}>
          <AnalyzeAction noteId={noteId} />
          <Text weight={500}>{t('ai.title')}</Text>
          <StatusText status={status} />
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={4}>
          <AnalyzeSettings />
          <ActionIcon
            icon={PanelRightClose}
            title={t('annotation.togglePanel')}
            tooltipProps={{ hotkey: toggleRightPanelHotkey }}
            onClick={() => toggleAnnotationPanel(false)}
          />
        </Flexbox>
      </Flexbox>
      <Flexbox flex={1} style={{ overflow: 'hidden' }}>
        <Flexbox flex={1} ref={bodyRef} style={{ overflowY: 'auto' }}>
          <Flexbox className={styles.section} gap={8}>
            {note.annotation?.content ? (
              <Markdown fontSize={13} variant={'chat'}>
                {note.annotation.content}
              </Markdown>
            ) : (
              <Text color={cssVar.colorTextTertiary} fontSize={12}>
                {note.content.trim() ? t('annotation.waiting') : t('annotation.emptyNote')}
              </Text>
            )}
            <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
              <Flexbox horizontal gap={6} wrap={'wrap'}>
                {note.tags.map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </Flexbox>
              <Button
                disabled={!note.content.trim()}
                icon={Sparkles}
                loading={diving}
                style={{ flex: 'none' }}
                onClick={() => diveInto(noteId)}
              >
                {dived ? t('annotation.redive') : t('annotation.dive')}
              </Button>
            </Flexbox>
          </Flexbox>
          <AgenticSections noteId={noteId} />
          {note.run && (
            <Flexbox className={styles.section} gap={8}>
              <Runs run={note.run} />
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
