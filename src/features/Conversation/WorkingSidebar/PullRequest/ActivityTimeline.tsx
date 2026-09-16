import type {
  DeviceGitPullRequestAction,
  DeviceGitPullRequestDetail,
  DeviceGitPullRequestReview,
} from '@lobechat/types';
import { Flexbox, Icon, Markdown } from '@lobehub/ui';
import { Avatar, Button, TextArea } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import { CheckIcon, CircleSlashIcon, EyeIcon, GitCommitHorizontalIcon, XIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Tone } from './mergeDockData';
import { timeAgo, TONE_COLOR, type TranslateKey } from './prVisual';
import type { PullRequestBusy } from './usePullRequestActions';

const styles = createStaticStyles(({ css, cssVar }) => ({
  comment: css`
    padding-block: 6px;
    padding-inline: 8px;
    border-radius: 8px;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  commentBodyWrap: css`
    overflow: hidden;
    min-width: 0;
    padding-inline-start: 26px;
  `,
  commentBody: css`
    overflow: hidden;

    min-width: 0;

    font-size: 13px;
    line-height: 20px;
    overflow-wrap: anywhere;

    table {
      overflow-x: auto;
      display: block;
      max-width: 100%;
    }

    img,
    video {
      max-width: 100%;
    }

    pre {
      overflow-x: auto;
      max-width: 100%;
    }
  `,
  commentHead: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};

    strong {
      font-weight: 500;
      color: ${cssVar.colorText};
    }
  `,
  composer: css`
    padding-block: 4px 0;
    padding-inline: 8px;
  `,
  event: css`
    min-height: 28px;
    padding-block: 2px;
    padding-inline: 8px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};

    strong {
      font-weight: 500;
      color: ${cssVar.colorTextSecondary};
    }

    code {
      font-family: ${cssVar.fontFamilyCode};
      font-size: 11px;
    }
  `,
}));

const REVIEW_VISUAL: Record<
  DeviceGitPullRequestReview['state'],
  { icon: LucideIcon; labelKey: string; tone: Tone }
> = {
  APPROVED: { icon: CheckIcon, labelKey: 'workingPanel.pr.activity.approved', tone: 'success' },
  CHANGES_REQUESTED: {
    icon: XIcon,
    labelKey: 'workingPanel.pr.activity.changesRequested',
    tone: 'error',
  },
  COMMENTED: { icon: EyeIcon, labelKey: 'workingPanel.pr.activity.commented', tone: 'neutral' },
  DISMISSED: {
    icon: CircleSlashIcon,
    labelKey: 'workingPanel.pr.activity.dismissed',
    tone: 'neutral',
  },
  PENDING: { icon: EyeIcon, labelKey: 'workingPanel.pr.activity.commented', tone: 'neutral' },
};

type Entry =
  | { at: string; kind: 'comment'; author: string; body: string; id: string }
  | { at: string; kind: 'commit'; author: string; sha: string }
  | { at: string; kind: 'review'; author: string; state: DeviceGitPullRequestReview['state'] };

const buildTimeline = (detail: DeviceGitPullRequestDetail): Entry[] =>
  [
    ...detail.comments.map<Entry>((comment) => ({
      at: comment.createdAt,
      author: comment.author,
      body: comment.body,
      id: comment.id,
      kind: 'comment',
    })),
    ...detail.commits.map<Entry>((commit) => ({
      at: commit.committedAt,
      author: commit.author,
      kind: 'commit',
      sha: commit.sha,
    })),
    ...detail.reviews.map<Entry>((review) => ({
      at: review.submittedAt,
      author: review.author,
      kind: 'review',
      state: review.state,
    })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

interface ActivityTimelineProps {
  busy?: PullRequestBusy;
  detail: DeviceGitPullRequestDetail;
  onAction: (action: DeviceGitPullRequestAction) => Promise<boolean>;
}

const ActivityTimeline = memo<ActivityTimelineProps>(({ busy, detail, onAction }) => {
  const { t } = useTranslation('chat');
  const tr = t as unknown as TranslateKey;
  const [draft, setDraft] = useState('');
  const timeline = useMemo(() => buildTimeline(detail), [detail]);

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    if (await onAction({ body, type: 'comment' })) setDraft('');
  };

  return (
    <>
      {timeline.map((entry) => {
        if (entry.kind === 'comment')
          return (
            <div className={styles.comment} key={entry.id}>
              <Flexbox horizontal align={'center'} className={styles.commentHead} gap={8}>
                <Avatar avatar={entry.author[0]?.toUpperCase()} size={18} />
                <strong>{entry.author}</strong>
                <span>{timeAgo(entry.at)}</span>
              </Flexbox>
              <div className={styles.commentBodyWrap}>
                <Markdown allowHtml className={styles.commentBody} fontSize={13} variant={'chat'}>
                  {entry.body}
                </Markdown>
              </div>
            </div>
          );
        const visual =
          entry.kind === 'review'
            ? REVIEW_VISUAL[entry.state]
            : {
                icon: GitCommitHorizontalIcon,
                labelKey: 'workingPanel.pr.activity.committed',
                tone: 'neutral' as Tone,
              };
        return (
          <Flexbox
            horizontal
            align={'center'}
            className={styles.event}
            gap={8}
            key={entry.kind === 'commit' ? entry.sha : `review:${entry.author}:${entry.at}`}
          >
            <Icon
              icon={visual.icon}
              size={14}
              style={visual.tone === 'neutral' ? undefined : { color: TONE_COLOR[visual.tone] }}
            />
            <span>
              <strong>{entry.author}</strong> {tr(visual.labelKey)}{' '}
              {entry.kind === 'commit' && <code>{entry.sha.slice(0, 7)}</code>} ·{' '}
              {timeAgo(entry.at)}
            </span>
          </Flexbox>
        );
      })}
      <Flexbox className={styles.composer} gap={6}>
        <TextArea
          autoSize={{ minRows: 1 }}
          placeholder={t('workingPanel.pr.composer.placeholder')}
          value={draft}
          variant={'filled'}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Flexbox horizontal justify={'flex-end'}>
          <Button
            disabled={!draft.trim() || !!busy}
            loading={busy === 'comment'}
            size={'small'}
            onClick={() => void submit()}
          >
            {t('workingPanel.pr.composer.submit')}
          </Button>
        </Flexbox>
      </Flexbox>
    </>
  );
});

ActivityTimeline.displayName = 'PullRequestActivityTimeline';

export default ActivityTimeline;
