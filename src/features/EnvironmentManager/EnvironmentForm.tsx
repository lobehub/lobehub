'use client';

import { Github } from '@lobehub/icons';
import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Button, Switch, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { FolderGit2Icon, HardDriveIcon, InfoIcon, PencilIcon, TerminalIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import {
  type SandboxEnvironmentSpecification,
  sandboxWorkspaceService,
} from '@/services/sandboxWorkspace';

import EnvironmentVariables from './EnvironmentVariables';
import { describeError } from './errorMessage';
import GithubRepositoryPicker, { type GithubRepositorySelection } from './GithubRepositoryPicker';
import InlineField from './InlineField';
import PanelSection from './PanelSection';
import TabPane from './TabPane';
import type { SandboxEnvironment } from './useEnvironmentData';

const styles = createStaticStyles(({ css }) => ({
  /** The same box every other value sits in; here it holds a repository. */
  box: css`
    display: flex;
    gap: 10px;
    align-items: center;

    min-height: 36px;
    padding-block: 6px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorFillQuaternary};
  `,
}));

/**
 * Which part of the specification the form is showing. The panel splits it
 * across two tabs; every field saves on its own, so the split is only about
 * what is on screen.
 */
export type EnvironmentFormSection = 'settings' | 'variables';

interface EnvironmentFormProps {
  environment: SandboxEnvironment;
  onSave: (params: {
    configuration?: SandboxEnvironmentSpecification;
    description?: string;
    name?: string;
  }) => Promise<void>;
  section: EnvironmentFormSection;
}

/**
 * Network access is on unless someone says otherwise, and an untouched
 * specification carries nothing rather than pinning the default into storage.
 */
const DEFAULT_INTERNET_ACCESS = true;

/**
 * Whether a change touches what a build is made from. The same three keys the
 * server compares to mark an instance stale, so the toast and the tag agree.
 */
const affectsBuild = (
  before: SandboxEnvironmentSpecification,
  after: SandboxEnvironmentSpecification,
): boolean =>
  (['bootstrapCommand', 'env', 'sources'] as const).some(
    (key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null),
  );

/** Drop the keys a blank value would otherwise store as empty. */
const compact = (configuration: SandboxEnvironmentSpecification): SandboxEnvironmentSpecification =>
  Object.fromEntries(
    Object.entries(configuration).filter(([, value]) => {
      if (value === undefined || value === '') return false;
      if (Array.isArray(value)) return value.length > 0;
      if (value && typeof value === 'object') return Object.keys(value).length > 0;
      return true;
    }),
  ) as SandboxEnvironmentSpecification;

/**
 * The branch an environment checks out, picked from the repository's own
 * list. Choosing beats typing here: a branch name is not something anyone
 * remembers exactly, and a typo is a build that fails minutes later.
 *
 * At rest it is the same box every other value sits in, and the list is
 * fetched only once the pencil is clicked — a hundred branches are not worth
 * a request to show the one that is set. Empty means the repository's default
 * branch, which is what the build checks out when none is named.
 *
 * Falls back to typing when GitHub is not connected or the list could not be
 * read — the repository may still be reachable to the build, and a field
 * that refuses to accept a value would block it for nothing.
 */
const BranchField = memo<{
  onSave: (ref: string) => Promise<void>;
  owner: string;
  repository: string;
  value: string;
}>(({ onSave, owner, repository, value }) => {
  const { t } = useTranslation('setting');
  const [editing, setEditing] = useState(false);
  const { data, error, isLoading } = useSWR(
    editing ? ['sandbox-github-branches', owner, repository] : null,
    () => sandboxWorkspaceService.listGithubBranches({ owner, repository }),
  );

  const canPick = !error && data?.connected !== false;

  return (
    <InlineField
      label={t('environments.form.ref')}
      placeholder={t('environments.form.refDefault')}
      select={canPick ? { loading: isLoading, options: data?.branches ?? [] } : undefined}
      value={value}
      onEditingChange={setEditing}
      onSave={onSave}
    />
  );
});

BranchField.displayName = 'EnvironmentBranchField';

/**
 * An environment's specification: where its source material comes from and
 * what makes it usable. This is the record of what the environment IS; what a
 * sandbox has built from it is a cache, which is why editing here marks every
 * working copy as needing a rebuild rather than changing one.
 *
 * Every field saves on its own the moment it is confirmed — Railway's settings
 * page is the reference. There is no draft and no save button: the old one sat
 * at the bottom of four sections, and changes typed above it were lost to a
 * tab switch before anyone scrolled down to it.
 */
const EnvironmentForm = memo<EnvironmentFormProps>(({ environment, onSave, section }) => {
  const { t } = useTranslation('setting');
  const configuration = (environment.configuration ?? {}) as SandboxEnvironmentSpecification;
  const [pickingRepository, setPickingRepository] = useState(false);
  const [busy, setBusy] = useState(false);

  /**
   * Write one change to the specification. The toast is the only trace a
   * per-field save leaves, so it carries the one consequence worth knowing
   * when there is one: a change to what a build depends on — sources, the
   * setup command, variables — puts every instance behind the specification.
   * The rest (maintenance command, network, regenerable paths) applies to the
   * next session as it is and says only "saved".
   */
  const saveConfiguration = async (changes: Partial<SandboxEnvironmentSpecification>) => {
    const next = compact({ ...configuration, ...changes });
    await onSave({ configuration: next });
    toast.success(
      t(
        affectsBuild(configuration, next)
          ? 'environments.form.savedStale'
          : 'environments.form.saved',
      ),
    );
  };

  /** For controls with no confirm step of their own: a switch, a disconnect. */
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.error(describeError(error, t, String(error)));
    } finally {
      setBusy(false);
    }
  };

  const source = configuration.sources?.[0];
  const setSource = (next: Partial<{ path: string; ref: string; url: string }> | undefined) =>
    saveConfiguration({
      sources:
        next === undefined
          ? []
          : [
              {
                kind: 'git' as const,
                url: next.url ?? source?.url ?? '',
                ...((next.path ?? source?.path) && { path: next.path ?? source?.path }),
                ...((next.ref ?? source?.ref) && { ref: next.ref ?? source?.ref }),
              },
            ],
    });

  // The picker speaks in owner/name; the specification stores a checkout URL.
  const repositoryPath = source?.url.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
  const selection = (() => {
    const [owner, repository] = repositoryPath?.split('/') ?? [];
    return owner && repository ? { defaultBranch: source?.ref, owner, repository } : undefined;
  })();

  const pickRepository = (picked: GithubRepositorySelection | undefined) => {
    if (!picked) return;
    setPickingRepository(false);
    // A repository just chosen keeps whatever folder was set, but takes the
    // new repository's default branch — the old branch belonged to the old one.
    void run(() =>
      saveConfiguration({
        sources: [
          {
            kind: 'git' as const,
            ...(source?.path && { path: source.path }),
            ...(picked.defaultBranch && { ref: picked.defaultBranch }),
            url: `https://github.com/${picked.owner}/${picked.repository}`,
          },
        ],
      }),
    );
  };

  if (section === 'variables') {
    return (
      /* Said plainly because the shape cannot enforce it: a text field cannot
         tell a region from a token. */
      <TabPane desc={t('environments.form.envHint')}>
        <EnvironmentVariables
          entries={Object.entries(configuration.env ?? {})}
          onSave={(entries) => saveConfiguration({ env: Object.fromEntries(entries) })}
        />
      </TabPane>
    );
  }

  return (
    <Flexbox>
      <PanelSection
        desc={t('environments.form.desc')}
        icon={InfoIcon}
        title={t('environments.form.basics')}
      >
        <InlineField
          required
          label={t('environments.nameLabel')}
          placeholder={t('environments.namePlaceholder')}
          value={environment.name}
          onSave={(name) => onSave({ name })}
        />
        <InlineField
          label={t('environments.form.description')}
          placeholder={t('environments.form.descriptionPlaceholder')}
          value={environment.description ?? ''}
          onSave={(description) => onSave({ description })}
        />
      </PanelSection>

      <PanelSection
        desc={t('environments.form.sourcesHint')}
        icon={FolderGit2Icon}
        title={t('environments.form.sources')}
        notice={
          /* On the first section the execution plane does not act on, and
             worded for all of them. An instance's own directory does persist —
             that part was verified end to end — so a panel-wide "none of this
             works yet" would call a working feature broken. */
          <Text fontSize={12} type={'warning'}>
            {t('environments.form.pending')}
          </Text>
        }
      >
        {/* One repository, so no list and no way to add a second. At rest it
            is a box naming the repository with a pencil and a disconnect,
            the way Railway shows a service's source; the same picker the
            create dialog uses takes over while a different one is chosen. */}
        {selection && !pickingRepository ? (
          <div className={styles.box}>
            <Github size={16} />
            <Text ellipsis style={{ flex: 1 }} weight={500}>
              {repositoryPath}
            </Text>
            <ActionIcon
              icon={PencilIcon}
              size={'small'}
              title={t('environments.form.changeRepository')}
              onClick={() => setPickingRepository(true)}
            />
            <Button loading={busy} size={'small'} onClick={() => run(() => setSource(undefined))}>
              {t('environments.form.disconnect')}
            </Button>
          </div>
        ) : (
          <Flexbox gap={8}>
            <GithubRepositoryPicker value={selection} onChange={pickRepository} />
            {selection && (
              <Flexbox horizontal>
                <Button size={'small'} onClick={() => setPickingRepository(false)}>
                  {t('cancel', { ns: 'common' })}
                </Button>
              </Flexbox>
            )}
          </Flexbox>
        )}

        {source && (
          <Flexbox horizontal align={'flex-start'} gap={12}>
            <div style={{ flex: 1 }}>
              {selection ? (
                <BranchField
                  owner={selection.owner}
                  repository={selection.repository}
                  value={source.ref ?? ''}
                  onSave={(ref) => setSource({ ref })}
                />
              ) : (
                <InlineField
                  label={t('environments.form.ref')}
                  placeholder={'main'}
                  value={source.ref ?? ''}
                  onSave={(ref) => setSource({ ref })}
                />
              )}
            </div>
            <div style={{ flex: 1 }}>
              <InlineField
                label={t('environments.form.path')}
                placeholder={'/'}
                value={source.path ?? ''}
                onSave={(path) => setSource({ path })}
              />
            </div>
          </Flexbox>
        )}
      </PanelSection>

      <PanelSection icon={TerminalIcon} title={t('environments.form.setup')}>
        <InlineField
          multiline
          desc={t('environments.form.bootstrapHint')}
          label={t('environments.form.bootstrap')}
          placeholder={'pnpm install'}
          value={configuration.bootstrapCommand ?? ''}
          onSave={(bootstrapCommand) => saveConfiguration({ bootstrapCommand })}
        />
        <InlineField
          multiline
          desc={t('environments.form.maintenanceHint')}
          label={t('environments.form.maintenance')}
          placeholder={'git pull --ff-only'}
          value={configuration.maintenanceCommand ?? ''}
          onSave={(maintenanceCommand) => saveConfiguration({ maintenanceCommand })}
        />
      </PanelSection>

      <PanelSection last icon={HardDriveIcon} title={t('environments.form.runtime')}>
        <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
          <Flexbox gap={2}>
            <Text fontSize={12} weight={500}>
              {t('environments.form.internetAccess')}
            </Text>
            <Text fontSize={12} type={'secondary'}>
              {t('environments.form.internetAccessHint')}
            </Text>
          </Flexbox>
          <Switch
            checked={configuration.internetAccess ?? DEFAULT_INTERNET_ACCESS}
            disabled={busy}
            onChange={(internetAccess) =>
              run(() =>
                saveConfiguration({
                  // The default is not stored: an environment that never
                  // mentions the network must keep meaning "on".
                  internetAccess:
                    internetAccess === DEFAULT_INTERNET_ACCESS ? undefined : internetAccess,
                }),
              )
            }
          />
        </Flexbox>
        <InlineField
          multiline
          desc={t('environments.form.excludeHint')}
          label={t('environments.form.exclude')}
          placeholder={'dist\n.cache'}
          // One path per line: a list of paths is a list of lines everywhere
          // else a person meets one.
          value={(configuration.excludePaths ?? []).join('\n')}
          onSave={(excludePaths) =>
            saveConfiguration({
              excludePaths: excludePaths
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean),
            })
          }
        />
      </PanelSection>
    </Flexbox>
  );
});

EnvironmentForm.displayName = 'EnvironmentForm';

export default EnvironmentForm;
