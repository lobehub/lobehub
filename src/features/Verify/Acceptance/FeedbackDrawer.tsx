'use client';

import type { AcceptanceAttachment } from '@lobechat/types';
import { Drawer, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import dayjs from 'dayjs';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { AttachmentThumbs } from './attachments';

const styles = createStaticStyles(({ css }) => ({
  clickable: css`
    cursor: pointer;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  meta: css`
    flex: none;
    font-size: 11px;
    color: ${cssVar.colorTextQuaternary};
    white-space: nowrap;
  `,
  /* One feedback event as a list row — hairline-separated, no card chrome.
     The drawer is an audit trail; rows read as entries in a ledger. Roomy
     vertical rhythm: cramped rows made the trail read as one dense block. */
  row: css`
    padding-block: 14px;
    padding-inline: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    &:last-child {
      border-block-end: none;
    }
  `,
  sectionTitle: css`
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
    letter-spacing: 0.04em;
  `,
  seq: css`
    flex: none;
    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

/** One feedback event, flattened for the clearing list — check-scoped or group/global. */
export interface FeedbackListEntry {
  /** Number of circled regions carried by the feedback (check rejects). */
  annotationCount?: number;
  /** Resolved screenshots the reviewer attached to the feedback. */
  attachments?: AcceptanceAttachment[];
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

const EntryRow = memo<{
  entry: FeedbackListEntry;
  onJumpToCheck: (checkId: string) => void;
}>(({ entry, onJumpToCheck }) => {
  const { t } = useTranslation('verify');
  const isCheck = entry.kind === 'check';
  const metaBits = [
    entry.annotationCount
      ? t('acceptance.feedback.annotations', { count: entry.annotationCount })
      : null,
    `${t('acceptance.round', { round: entry.roundIndex })} · ${dayjs(entry.createdAt).format('MM-DD HH:mm')}`,
  ].filter(Boolean);

  return (
    <Flexbox
      className={cx(styles.row, entry.checkId && styles.clickable)}
      gap={6}
      style={entry.stale ? { opacity: 0.55 } : undefined}
      onClick={entry.checkId ? () => onJumpToCheck(entry.checkId!) : undefined}
    >
      <Flexbox horizontal align={'center'} gap={6}>
        {isCheck ? (
          <>
            <span className={styles.seq}>C{entry.checkSeq}</span>
            <Text ellipsis style={{ fontSize: 13, minWidth: 0 }}>
              {entry.title}
            </Text>
          </>
        ) : (
          <Text ellipsis style={{ fontSize: 13, minWidth: 0 }}>
            {entry.groupLabel
              ? t('acceptance.feedback.group', { label: entry.groupLabel })
              : t('acceptance.feedback.global')}
          </Text>
        )}
        <Flexbox flex={1} />
        <span className={styles.meta}>{metaBits.join(' · ')}</span>
      </Flexbox>
      {entry.comment && (
        <Text style={{ fontSize: 12 }} type={'secondary'}>
          {entry.comment}
        </Text>
      )}
      <AttachmentThumbs attachments={entry.attachments} />
    </Flexbox>
  );
});

/**
 * The feedback clearing house: what THIS round's review has queued for the
 * next verification round (active), and everything earlier rounds already
 * consumed (history) — one place to audit the whole trail. Entries render as
 * a flat hairline list, not cards — it is a ledger, not a gallery.
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
      <Flexbox gap={20}>
        <Flexbox gap={4}>
          <Text className={styles.sectionTitle}>
            {t('acceptance.feedback.current', { count: active.length })}
          </Text>
          {active.length === 0 && (
            <Text fontSize={12} type={'secondary'}>
              {t('acceptance.feedback.empty')}
            </Text>
          )}
          <Flexbox>
            {active.map((entry, index) => (
              <EntryRow entry={entry} key={index} onJumpToCheck={onJumpToCheck} />
            ))}
          </Flexbox>
        </Flexbox>
        {history.length > 0 && (
          <Flexbox gap={4}>
            <Text className={styles.sectionTitle}>
              {t('acceptance.feedback.history', { count: history.length })}
            </Text>
            <Flexbox>
              {history.map((entry, index) => (
                <EntryRow entry={entry} key={index} onJumpToCheck={onJumpToCheck} />
              ))}
            </Flexbox>
          </Flexbox>
        )}
      </Flexbox>
    </Drawer>
  );
});

FeedbackDrawer.displayName = 'AcceptanceFeedbackDrawer';

export default FeedbackDrawer;
