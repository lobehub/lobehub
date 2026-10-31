'use client';

import { Github } from '@lobehub/icons';
import { Button, Flexbox, Icon, Select, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowRightIcon, LockIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { useGithubRepositories } from './useGithubRepositories';

const styles = stylex.create({
  field: { display: 'flex', flex: '1', flexDirection: 'column', gap: '6px', minWidth: '0' },
  label: { fontSize: '12px', fontWeight: 500, color: cssVar.colorTextSecondary },
  guide: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    paddingBlock: '12px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  guideText: { flex: '1', minWidth: '0', fontSize: '12px', color: cssVar.colorTextSecondary },
  option: { display: 'flex', gap: '6px', alignItems: 'center', minWidth: '0' },
  optionName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  private: { flex: 'none', color: cssVar.colorTextQuaternary },
});

export interface GithubRepositorySelection {
  defaultBranch?: string;
  /** The account the repository belongs to, as GitHub reports it. */
  owner: string;
  repository: string;
}

interface GithubRepositoryPickerProps {
  onChange: (selection: GithubRepositorySelection | undefined) => void;
  /**
   * Run before navigating away from this picker. The picker lives in a dialog,
   * and leaving it open behind the credentials page would strand whatever the
   * person had already typed.
   */
  onLeave?: () => void;
  value?: GithubRepositorySelection;
}

/**
 * The one repository an environment builds from, chosen in two steps:
 * organization, then repository within it.
 *
 * Both lists come from a single `/user/repos` call, which already spans every
 * organization the account belongs to. The organizations are derived from what
 * came back rather than fetched separately: an organization holding nothing
 * this account can reach is not a choice, and listing per organization would
 * be one request per organization for a set already in hand — switching
 * organizations costs nothing here.
 *
 * Both are searchable, because either half can be the one the person
 * remembers: sometimes the organization, sometimes the project.
 *
 * Choosing nothing is a choice: an environment with no repository is a blank
 * working directory, which is a reasonable thing to want.
 *
 * No GitHub connection is not an error and not a dead end — it is one click
 * from being resolved, so the picker offers that click rather than reporting
 * a state and leaving the person to find the page themselves.
 */
const GithubRepositoryPicker = memo<GithubRepositoryPickerProps>(({ onChange, onLeave, value }) => {
  const { t } = useTranslation('setting');
  const navigate = useWorkspaceAwareNavigate();
  const [owner, setOwner] = useState<string | undefined>(value?.owner);

  const connectGithub = () => {
    onLeave?.();
    navigate('/settings/credential');
  };

  const { data, isLoading, isValidating, retry, state } = useGithubRepositories();

  // Memoised, not a bare `??` fallback: a fresh `[]` on every render would
  // make both lists below recompute every time, which is exactly what they are
  // memoised to avoid.
  const repositories = useMemo(() => data?.repositories ?? [], [data]);

  // Listing order is "most recently updated first", so the owner whose work is
  // freshest leads — the same ranking the flat list had.
  const owners = useMemo(
    () => [...new Set(repositories.map((item) => item.owner))],
    [repositories],
  );

  const owned = useMemo(
    () => (owner ? repositories.filter((item) => item.owner === owner) : []),
    [owner, repositories],
  );

  const guide =
    state === 'error'
      ? {
          action: 'retry',
          text: t(
            repositories.length > 0
              ? 'environments.github.refreshFailed'
              : 'environments.github.loadFailed',
          ),
        }
      : state === 'disconnected'
        ? { action: 'connect', text: t('environments.github.notConnected') }
        : state === 'empty'
          ? { action: 'review', text: t('environments.github.noRepositories') }
          : undefined;

  const guideContent = guide && (
    <div {...stylex.props(styles.guide)} role={state === 'error' ? 'alert' : undefined}>
      <span {...stylex.props(styles.guideText)}>{guide.text}</span>
      <Button
        loading={guide.action === 'retry' && isValidating}
        size={'small'}
        onClick={guide.action === 'retry' ? () => void retry() : connectGithub}
      >
        {guide.action === 'retry'
          ? t('retry', { ns: 'common' })
          : t(
              guide.action === 'connect'
                ? 'environments.github.connect'
                : 'environments.github.reviewAccess',
            )}
        {guide.action !== 'retry' && <Icon icon={ArrowRightIcon} size={12} />}
      </Button>
    </div>
  );

  if (guide && (state !== 'error' || repositories.length === 0))
    return (
      <Flexbox gap={6}>
        <Flexbox horizontal align={'center'} gap={6}>
          <Github size={13} />
          <span {...stylex.props(styles.label)}>{t('environments.github.label')}</span>
        </Flexbox>
        {guideContent}
      </Flexbox>
    );

  return (
    <Flexbox gap={8}>
      <Flexbox horizontal align={'center'} gap={6}>
        <Github size={13} />
        <span {...stylex.props(styles.label)}>{t('environments.github.label')}</span>
        <Text fontSize={11} type={'secondary'}>
          {t('environments.github.optional')}
        </Text>
      </Flexbox>

      {guideContent}
      <Flexbox horizontal gap={8}>
        <div {...stylex.props(styles.field)}>
          <Text fontSize={11} type={'secondary'}>
            {t('environments.github.organization')}
          </Text>
          <Select
            allowClear
            showSearch
            loading={isLoading}
            options={owners.map((login) => ({ label: login, value: login }))}
            placeholder={t('environments.github.organizationPlaceholder')}
            value={owner ?? null}
            onChange={(next) => {
              const login = typeof next === 'string' && next ? next : undefined;
              setOwner(login);
              // The same name under a different owner is a different
              // repository, so the pick cannot survive the switch.
              onChange(undefined);
            }}
          />
        </div>

        <div {...stylex.props(styles.field)}>
          <Text fontSize={11} type={'secondary'}>
            {t('environments.github.repository')}
          </Text>
          <Select
            allowClear
            showSearch
            disabled={!owner}
            value={value?.repository ?? null}
            options={owned.map((repository) => ({
              label: (
                <span {...stylex.props(styles.option)}>
                  <span {...stylex.props(styles.optionName)}>{repository.name}</span>
                  {repository.isPrivate && (
                    <Icon
                      className={stylex.props(styles.private).className}
                      icon={LockIcon}
                      size={12}
                    />
                  )}
                </span>
              ),
              value: repository.name,
            }))}
            placeholder={t(
              owner
                ? 'environments.github.repositoryPlaceholder'
                : 'environments.github.repositoryPending',
            )}
            onChange={(next) => {
              const name = typeof next === 'string' && next ? next : undefined;
              const picked = owned.find((repository) => repository.name === name);

              onChange(
                picked && owner
                  ? { defaultBranch: picked.defaultBranch, owner, repository: picked.name }
                  : undefined,
              );
            }}
          />
        </div>
      </Flexbox>
    </Flexbox>
  );
});

GithubRepositoryPicker.displayName = 'GithubRepositoryPicker';

export default GithubRepositoryPicker;
