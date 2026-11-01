'use client';

import type { LinearIssuePage, LinearIssueSummary } from '@lobechat/types';
import { ActionIcon, Button, Center, Checkbox, Flexbox, Icon, Skeleton, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckIcon, ExternalLinkIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import useSWRInfinite from 'swr/infinite';

import LinearIcon from '@/features/Integrations/Linear/LinearIcon';
import { linearKeys } from '@/features/Integrations/Linear/swrKeys';
import { type LinearIssueFilterParams, linearService } from '@/services/linear';

import StateIcon from './StateIcon';
import { linearSyncErrorMessage } from './utils';

const styles = stylex.create({
  body: {
    height: 320,
    overflowY: 'auto',
  },
  // Without the 40px header the frame keeps the same height, so picking a team does not move the footer.
  bodyWithoutHead: {
    height: 360,
  },
  frame: {
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    overflow: 'hidden',
  },
  head: {
    backgroundColor: cssVar.colorFillQuaternary,
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    height: 40,
    paddingInline: 12,
  },
  identifier: {
    color: cssVar.colorTextTertiary,
    flexShrink: 0,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 12,
    width: 64,
  },
  row: {
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    cursor: 'pointer',
    height: 40,
    paddingInline: 12,
  },
  rowDisabled: {
    cursor: 'default',
  },
  synced: {
    color: cssVar.colorTextSecondary,
    flexShrink: 0,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 12,
  },
});

interface IssueListProps {
  disabled?: boolean;
  /** Null until a team is chosen. */
  filter: LinearIssueFilterParams | null;
  onSelectionChange: (ids: string[], selected: boolean) => void;
  selected: Set<string>;
}

/** The issues matching the filter, pick-able one by one, newest activity first. */
const IssueList = memo<IssueListProps>(({ disabled, filter, onSelectionChange, selected }) => {
  const { t } = useTranslation('integration');

  const { data, error, isLoading, isValidating, setSize, size } = useSWRInfinite(
    (index: number, previous: LinearIssuePage | null) => {
      if (!filter || (previous && !previous.hasMore)) return null;
      return [...linearKeys.issues(filter), index === 0 ? null : previous?.cursor] as const;
    },
    ([, , , , , cursor]) => linearService.listIssues({ ...filter!, cursor: cursor ?? undefined }),
    // The first page is refetched even when cached: an import since it was read
    // changes which issues show as synced.
    { revalidateOnFocus: false },
  );

  const issues: LinearIssueSummary[] = (data ?? []).flatMap((page) => page.issues ?? []);
  const ids = issues.map((issue) => issue.id);
  const selectedCount = ids.filter((id) => selected.has(id)).length;
  const allSelected = ids.length > 0 && selectedCount === ids.length;
  const hasMore = data?.at(-1)?.hasMore;

  const placeholder = (content: ReactNode) => (
    <Center gap={8} height={'100%'} paddingInline={24}>
      {content}
    </Center>
  );

  let body: ReactNode;
  if (!filter) {
    body = placeholder(
      <>
        <LinearIcon size={24} style={{ opacity: 0.25 }} />
        <Text type={'secondary'}>{t('linear.sync.list.pickTeam')}</Text>
      </>,
    );
  } else if (error) {
    body = placeholder(<Text type={'danger'}>{linearSyncErrorMessage(error, t)}</Text>);
  } else if (isLoading || !data) {
    body = (
      <Flexbox gap={12} padding={12}>
        {[0, 1, 2, 3].map((index) => (
          <Skeleton height={16} key={index} />
        ))}
      </Flexbox>
    );
  } else if (issues.length === 0) {
    body = placeholder(<Text type={'secondary'}>{t('linear.sync.list.empty')}</Text>);
  } else {
    body = (
      <>
        {issues.map((issue) => {
          const checked = selected.has(issue.id);
          return (
            <Flexbox
              horizontal
              align={'center'}
              gap={12}
              key={issue.id}
              {...stylex.props(styles.row, disabled && styles.rowDisabled)}
              onClick={(event) => {
                // The checkbox and the Linear link handle their own clicks.
                const target = event.target as HTMLElement;
                if (disabled || target.closest('button, a, [role="button"], [role="checkbox"]'))
                  return;
                onSelectionChange([issue.id], !checked);
              }}
            >
              <Checkbox
                aria-label={issue.identifier}
                checked={checked}
                disabled={disabled}
                onChange={(next) => onSelectionChange([issue.id], next)}
              />
              <StateIcon name={issue.stateName} type={issue.stateType} />
              <span {...stylex.props(styles.identifier)}>{issue.identifier}</span>
              <Text ellipsis style={{ flex: 1, minWidth: 0 }} title={issue.title}>
                {issue.title}
              </Text>
              {issue.linkedTaskIdentifier ? (
                <Flexbox
                  horizontal
                  align={'center'}
                  aria-label={t('linear.sync.list.linked', { task: issue.linkedTaskIdentifier })}
                  gap={4}
                  role={'img'}
                  title={t('linear.sync.list.linked', { task: issue.linkedTaskIdentifier })}
                  {...stylex.props(styles.synced)}
                >
                  <Icon color={cssVar.colorSuccess} icon={CheckIcon} size={14} />
                  {issue.linkedTaskIdentifier}
                </Flexbox>
              ) : null}
              <ActionIcon
                icon={ExternalLinkIcon}
                size={'small'}
                title={t('linear.sync.list.openInLinear')}
                onClick={() => window.open(issue.url, '_blank', 'noopener,noreferrer')}
              />
            </Flexbox>
          );
        })}
        {hasMore ? (
          <Center paddingBlock={8}>
            <Button
              disabled={disabled}
              loading={isValidating && size > data.length}
              size={'small'}
              type={'text'}
              onClick={() => setSize(size + 1)}
            >
              {t('linear.sync.list.loadMore')}
            </Button>
          </Center>
        ) : null}
      </>
    );
  }

  return (
    <div {...stylex.props(styles.frame)}>
      {filter ? (
        <Flexbox horizontal align={'center'} gap={12} {...stylex.props(styles.head)}>
          <Checkbox
            aria-label={t('linear.sync.list.selectAll', { count: issues.length })}
            checked={allSelected}
            disabled={disabled || issues.length === 0}
            indeterminate={selectedCount > 0 && !allSelected}
            onChange={(checked) => onSelectionChange(ids, checked)}
          />
          <Text fontSize={12} type={'secondary'}>
            {selectedCount > 0
              ? t('linear.sync.list.selected', { count: selectedCount })
              : t('linear.sync.list.count', { count: issues.length })}
          </Text>
        </Flexbox>
      ) : null}
      <div {...stylex.props(styles.body, !filter && styles.bodyWithoutHead)}>{body}</div>
    </div>
  );
});

IssueList.displayName = 'LinearIssueList';

export default IssueList;
