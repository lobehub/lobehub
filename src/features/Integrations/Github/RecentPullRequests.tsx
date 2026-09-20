'use client';

import type { ScmChangeRequestItem } from '@lobechat/database/schemas';
import { Block, Flexbox, Icon } from '@lobehub/ui';
import { Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    padding-block: 4px;
    padding-inline: 16px;
    border-radius: ${cssVar.borderRadiusLG};
  `,
  emptyState: css`
    padding-block: 32px;
    padding-inline: 24px;
    border: 1px dashed ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
  link: css`
    overflow: hidden;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
  row: css`
    padding-block: 12px;

    &:not(:last-child) {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
}));

const STATE_ICON = {
  closed: GitPullRequestClosedIcon,
  merged: GitMergeIcon,
  open: GitPullRequestIcon,
} as const;

const STATE_COLOR = { closed: 'default', merged: 'purple', open: 'green' } as const;
const CI_COLOR = { failure: 'red', pending: 'gold', success: 'green', unknown: 'default' } as const;
const REVIEW_COLOR = {
  approved: 'green',
  changes_requested: 'orange',
  review_required: 'default',
} as const;

interface RecentPullRequestsProps {
  items: ScmChangeRequestItem[];
}

/** The pull requests GitHub has reported on, newest activity first. */
const RecentPullRequests = memo<RecentPullRequestsProps>(({ items }) => {
  const { t } = useTranslation('integration');

  return (
    <Flexbox gap={12}>
      <Flexbox gap={4}>
        <Text strong style={{ fontSize: 15 }}>
          {t('github.activity.title')}
        </Text>
        <Text style={{ fontSize: 13 }} type="secondary">
          {t('github.activity.description')}
        </Text>
      </Flexbox>
      {items.length === 0 ? (
        <div className={styles.emptyState}>{t('github.activity.empty')}</div>
      ) : (
        <Block className={styles.card} variant={'outlined'}>
          {items.map((item) => (
            <Flexbox horizontal align="center" className={styles.row} gap={12} key={item.id}>
              <Icon icon={STATE_ICON[item.state]} size={18} />
              <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                <a
                  className={styles.link}
                  href={item.url}
                  rel="noreferrer"
                  target="_blank"
                  title={item.title ?? item.url}
                >
                  <Text strong>
                    {item.repoFullName}#{item.number}
                  </Text>
                  {item.title ? <Text> {item.title}</Text> : null}
                </a>
                <Flexbox horizontal align="center" gap={8} wrap="wrap">
                  {item.lastEventKind ? (
                    <Text style={{ fontSize: 12 }} type="secondary">
                      {t(`github.activity.event.${item.lastEventKind}` as any)} ·{' '}
                      {new Date(item.updatedAt).toLocaleString()}
                    </Text>
                  ) : null}
                  {item.acceptanceId ? (
                    <a href={`/acceptance/${item.acceptanceId}`} style={{ fontSize: 12 }}>
                      {t('github.activity.linkedAcceptance')}
                    </a>
                  ) : null}
                </Flexbox>
              </Flexbox>
              <Flexbox horizontal align="center" gap={6} wrap="wrap">
                {item.isDraft && item.state === 'open' ? (
                  <Tag size="small">{t('github.activity.draft')}</Tag>
                ) : null}
                <Tag color={STATE_COLOR[item.state]} size="small">
                  {t(`github.activity.state.${item.state}`)}
                </Tag>
                {item.ciStatus ? (
                  <Tag color={CI_COLOR[item.ciStatus]} size="small">
                    {t(`github.activity.ci.${item.ciStatus}`)}
                  </Tag>
                ) : null}
                {item.reviewDecision ? (
                  <Tag color={REVIEW_COLOR[item.reviewDecision]} size="small">
                    {t(`github.activity.review.${item.reviewDecision}`)}
                  </Tag>
                ) : null}
              </Flexbox>
            </Flexbox>
          ))}
        </Block>
      )}
    </Flexbox>
  );
});

RecentPullRequests.displayName = 'GithubRecentPullRequests';

export default RecentPullRequests;
