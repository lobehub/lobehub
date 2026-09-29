'use client';

import { Github } from '@lobehub/icons';
import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Select, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowRightIcon, LockIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { sandboxWorkspaceService } from '@/services/sandboxWorkspace';

const styles = createStaticStyles(({ css }) => ({
  field: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 6px;

    min-width: 0;
  `,
  label: css`
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  guide: css`
    display: flex;
    gap: 10px;
    align-items: center;

    padding-block: 12px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorFillQuaternary};
  `,
  guideText: css`
    flex: 1;
    min-width: 0;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  option: css`
    display: flex;
    gap: 6px;
    align-items: center;
    min-width: 0;
  `,
  optionName: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  private: css`
    flex: none;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

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

  const { data, isLoading } = useSWR('sandbox-github-repositories', () =>
    sandboxWorkspaceService.listGithubRepositories(),
  );

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

  // Both of these are the same kind of answer — "there is nothing to pick from
  // yet, and here is what to do about it" — so they share one shape. An empty
  // list on a live connection usually means the connection cannot see the
  // organization the person is thinking of, which is fixed in the same place.
  const guide =
    data?.connected === false
      ? { action: 'connect', text: t('environments.github.notConnected') }
      : !isLoading && repositories.length === 0
        ? { action: 'review', text: t('environments.github.noRepositories') }
        : undefined;

  if (guide)
    return (
      <Flexbox gap={6}>
        <Flexbox horizontal align={'center'} gap={6}>
          <Github size={13} />
          <span className={styles.label}>{t('environments.github.label')}</span>
        </Flexbox>
        <div className={styles.guide}>
          <span className={styles.guideText}>{guide.text}</span>
          <Button size={'small'} onClick={connectGithub}>
            {t(
              guide.action === 'connect'
                ? 'environments.github.connect'
                : 'environments.github.reviewAccess',
            )}
            <Icon icon={ArrowRightIcon} size={12} />
          </Button>
        </div>
      </Flexbox>
    );

  return (
    <Flexbox gap={8}>
      <Flexbox horizontal align={'center'} gap={6}>
        <Github size={13} />
        <span className={styles.label}>{t('environments.github.label')}</span>
        <Text fontSize={11} type={'secondary'}>
          {t('environments.github.optional')}
        </Text>
      </Flexbox>

      <Flexbox horizontal gap={8}>
        <div className={styles.field}>
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

        <div className={styles.field}>
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
                <span className={styles.option}>
                  <span className={styles.optionName}>{repository.name}</span>
                  {repository.isPrivate && (
                    <Icon className={styles.private} icon={LockIcon} size={12} />
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
