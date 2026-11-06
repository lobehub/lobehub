import type { ScmRepositoryListItem } from '@lobechat/types';
import { Avatar, Button, Flexbox, Icon, SearchBar, Skeleton, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowRightIcon, LockIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useScmRepositories } from './useScmRepositories';

const styles = stylex.create({
  guide: {
    alignItems: 'center',
    backgroundColor: cssVar.colorFillQuaternary,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'flex',
    gap: 10,
    paddingBlock: 12,
    paddingInline: 12,
  },
  guideText: {
    color: cssVar.colorTextSecondary,
    flex: '1',
    fontSize: 12,
    minWidth: 0,
  },
  list: {
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    borderStyle: 'solid',
    borderWidth: 1,
    maxHeight: 252,
    overflowY: 'auto',
  },
  row: {
    alignItems: 'center',
    backgroundColor: {
      ':hover': cssVar.colorFillTertiary,
      'default': 'transparent',
    },
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: {
      ':last-child': 'none',
      'default': 'solid',
    },
    borderBlockEndWidth: 1,
    borderInlineWidth: 0,
    borderBlockStartWidth: 0,
    color: 'inherit',
    cursor: 'pointer',
    display: 'flex',
    gap: 10,
    paddingBlock: 8,
    paddingInline: 12,
    textAlign: 'start',
    width: '100%',
  },
  selected: {
    backgroundColor: {
      ':hover': cssVar.colorFillSecondary,
      'default': cssVar.colorFillSecondary,
    },
  },
  private: {
    color: cssVar.colorTextQuaternary,
    flex: 'none',
  },
});

interface RepositoryListProps {
  /** Leave the dialog for the GitHub integration settings. */
  onConnect: () => void;
  onSelect: (repository: ScmRepositoryListItem) => void;
  /** `owner/name` of the repository the URL field currently names. */
  selected?: string;
}

/**
 * The repositories the connected GitHub App can read, most recently pushed
 * first and searchable. Not being connected is one click from being solved,
 * so that state offers the click instead of only reporting it.
 */
const RepositoryList = ({ onConnect, onSelect, selected }: RepositoryListProps) => {
  const { t } = useTranslation(['project', 'common']);
  const { isValidating, repositories, retry, state, truncated } = useScmRepositories();
  const [keyword, setKeyword] = useState('');

  const filtered = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    if (!repositories || !query) return repositories ?? [];
    return repositories.filter(
      (repo) =>
        repo.fullName.toLowerCase().includes(query) ||
        repo.description?.toLowerCase().includes(query),
    );
  }, [keyword, repositories]);

  const selectedKey = selected?.toLowerCase();

  const label = (
    <Text fontSize={13} weight={500}>
      {t('createFromGithub.repositoriesLabel')}
    </Text>
  );

  if (state === 'loading')
    return (
      <Flexbox gap={6}>
        {label}
        <Skeleton height={44} radius={6} />
        <Skeleton height={44} radius={6} />
        <Skeleton height={44} radius={6} />
      </Flexbox>
    );

  if (state !== 'ready') {
    const guide = {
      disconnected: { action: 'connect', text: t('createFromGithub.disconnected') },
      empty: { action: 'manage', text: t('createFromGithub.empty') },
      error: { action: 'retry', text: t('createFromGithub.loadFailed') },
      unconfigured: { action: undefined, text: t('createFromGithub.unconfigured') },
    }[state];

    return (
      <Flexbox gap={6}>
        {label}
        <div {...stylex.props(styles.guide)} role={state === 'error' ? 'alert' : undefined}>
          <span {...stylex.props(styles.guideText)}>{guide.text}</span>
          {guide.action && (
            <Button
              loading={guide.action === 'retry' && isValidating}
              type={guide.action === 'connect' ? 'primary' : 'default'}
              onClick={guide.action === 'retry' ? () => void retry() : onConnect}
            >
              {guide.action === 'retry'
                ? t('retry', { ns: 'common' })
                : t(
                    guide.action === 'connect'
                      ? 'createFromGithub.connect'
                      : 'createFromGithub.manageAccess',
                  )}
              {guide.action !== 'retry' && <Icon icon={ArrowRightIcon} size={12} />}
            </Button>
          )}
        </div>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={6}>
      {label}
      <SearchBar
        allowClear
        placeholder={t('createFromGithub.searchPlaceholder')}
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
      />
      {filtered.length === 0 ? (
        <Text fontSize={12} style={{ paddingBlock: 8, textAlign: 'center' }} type={'secondary'}>
          {t('createFromGithub.searchEmpty')}
        </Text>
      ) : (
        <div {...stylex.props(styles.list)} role={'listbox'}>
          {filtered.map((repo) => {
            const isSelected = repo.fullName.toLowerCase() === selectedKey;
            return (
              <button
                aria-selected={isSelected}
                key={repo.fullName}
                role={'option'}
                type={'button'}
                {...stylex.props(styles.row, isSelected && styles.selected)}
                onClick={() => onSelect(repo)}
              >
                <Avatar
                  avatar={repo.ownerAvatarUrl ?? undefined}
                  shape={'square'}
                  size={28}
                  title={repo.fullName}
                />
                <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                  <Flexbox horizontal align={'center'} gap={6}>
                    <Text ellipsis weight={500}>
                      {repo.fullName}
                    </Text>
                    {repo.private && (
                      <span {...stylex.props(styles.private)} title={t('createFromGithub.private')}>
                        <Icon icon={LockIcon} size={12} />
                      </span>
                    )}
                  </Flexbox>
                  {repo.description && (
                    <Text ellipsis fontSize={12} type={'secondary'}>
                      {repo.description}
                    </Text>
                  )}
                </Flexbox>
              </button>
            );
          })}
        </div>
      )}
      {truncated && (
        <Text fontSize={12} type={'secondary'}>
          {t('createFromGithub.truncated', { count: repositories?.length ?? 0 })}
        </Text>
      )}
    </Flexbox>
  );
};

export default RepositoryList;
