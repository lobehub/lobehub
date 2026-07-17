'use client';

import { Drawer, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { MessageSquareText, MessageSquareX } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    padding-block: 10px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  clickable: css`
    cursor: pointer;
    transition: border-color 0.2s;

    &:hover {
      border-color: ${cssVar.colorBorder};
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  sectionTitle: css`
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
    letter-spacing: 0.04em;
  `,
  seq: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

/** One feedback event, flattened for the clearing list — check-scoped or group/global. */
export interface FeedbackListEntry {
  /** Number of circled regions carried by the feedback (check rejects). */
  annotationCount?: number;
  /** Jump target — set for check-scoped entries. */
  checkId?: string;
  /** Check label ("C3") for check-scoped entries. */
  checkSeq?: number;
  comment: string;
  createdAt: string;
  /** Group label; '' = the whole-delivery (global) channel. */
  groupLabel?: string;
  kind: 'check' | 'group';
  roundIndex: number;
  /** Consumed by a later round — history, not the next round's input. */
  stale: boolean;
  /** Check title for check-scoped entries. */
  title?: string;
}

interface FeedbackDrawerProps {
  entries: FeedbackListEntry[];
  onClose: () => void;
  /** Expand + scroll to a check row in the union list. */
  onJumpToCheck: (checkId: string) => void;
  open: boolean;
}

const EntryCard = memo<{
  entry: FeedbackListEntry;
  onJumpToCheck: (checkId: string) => void;
}>(({ entry, onJumpToCheck }) => {
  const { t } = useTranslation('verify');
  const isCheck = entry.kind === 'check';
  return (
    <Flexbox
      className={`${styles.card} ${entry.checkId ? styles.clickable : ''}`}
      gap={6}
      style={entry.stale ? { opacity: 0.55 } : undefined}
      onClick={entry.checkId ? () => onJumpToCheck(entry.checkId!) : undefined}
    >
      <Flexbox horizontal align={'center'} gap={6}>
        <Icon
          color={entry.stale ? cssVar.colorTextQuaternary : cssVar.colorError}
          icon={isCheck ? MessageSquareX : MessageSquareText}
          size={13}
        />
        {isCheck ? (
          <>
            <span className={styles.seq}>C{entry.checkSeq}</span>
            <Text ellipsis style={{ fontSize: 13, minWidth: 0 }}>
              {entry.title}
            </Text>
          </>
        ) : (
          <Text style={{ fontSize: 13 }}>
            {entry.groupLabel
              ? t('acceptance.feedback.group', { label: entry.groupLabel })
              : t('acceptance.feedback.global')}
          </Text>
        )}
        <Flexbox flex={1} />
        {entry.annotationCount ? (
          <Tag size={'small'}>
            {t('acceptance.feedback.annotations', { count: entry.annotationCount })}
          </Tag>
        ) : null}
        <Text fontSize={12} type={'secondary'}>
          {t('acceptance.round', { round: entry.roundIndex })} ·{' '}
          {dayjs(entry.createdAt).format('MM-DD HH:mm')}
        </Text>
      </Flexbox>
      {entry.comment && <Text style={{ fontSize: 13 }}>{entry.comment}</Text>}
    </Flexbox>
  );
});

/**
 * The feedback clearing house: what THIS round's review has queued for the
 * next verification round (active), and everything earlier rounds already
 * consumed (history) — one place to audit the whole trail.
 */
const FeedbackDrawer = memo<FeedbackDrawerProps>(({ entries, onClose, onJumpToCheck, open }) => {
  const { t } = useTranslation('verify');
  const active = entries.filter((entry) => !entry.stale);
  const history = entries.filter((entry) => entry.stale);

  return (
    <Drawer
      open={open}
      placement={'right'}
      title={t('acceptance.feedback.title')}
      width={'min(92vw, 440px)'}
      onClose={onClose}
    >
      <Flexbox gap={16}>
        <Flexbox gap={8}>
          <Text className={styles.sectionTitle}>
            {t('acceptance.feedback.current', { count: active.length })}
          </Text>
          {active.length === 0 && (
            <Text fontSize={12} type={'secondary'}>
              {t('acceptance.feedback.empty')}
            </Text>
          )}
          {active.map((entry, index) => (
            <EntryCard entry={entry} key={index} onJumpToCheck={onJumpToCheck} />
          ))}
        </Flexbox>
        {history.length > 0 && (
          <Flexbox gap={8}>
            <Text className={styles.sectionTitle}>
              {t('acceptance.feedback.history', { count: history.length })}
            </Text>
            {history.map((entry, index) => (
              <EntryCard entry={entry} key={index} onJumpToCheck={onJumpToCheck} />
            ))}
          </Flexbox>
        )}
      </Flexbox>
    </Drawer>
  );
});

FeedbackDrawer.displayName = 'AcceptanceFeedbackDrawer';

export default FeedbackDrawer;
