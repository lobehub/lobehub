'use client';

import { layoutRepositorySources, repositoryFolderName } from '@lobechat/types';
import { Github } from '@lobehub/icons';
import {
  ActionIcon,
  Button,
  createStaticStyles,
  cssVar,
  Flexbox,
  Icon,
  Input,
  Text,
  toast,
} from '@lobehub/ui';
import {
  ChevronUpIcon,
  FolderGit2Icon,
  InfoIcon,
  PencilIcon,
  PlusIcon,
  TerminalIcon,
  Trash2Icon,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { parseGithubRepository } from '@/features/Projects/CreateFromGithub/githubRepository';
import { environmentService, type SandboxEnvironmentSpecification } from '@/services/environment';

import EnvironmentVariables from './EnvironmentVariables';
import { describeError } from './errorMessage';
import GithubRepositoryPicker, { type GithubRepositorySelection } from './GithubRepositoryPicker';
import InlineField from './InlineField';
import PanelSection from './PanelSection';
import TabPane from './TabPane';
import type { SandboxEnvironment } from './useEnvironmentData';

const styles = createStaticStyles(({ css }) => ({
  /** One repository: a row, with its fields underneath while edited. */
  item: css`
    padding-block: 8px;
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

/** What the form reads of an environment: a standalone one, or a project's. */
export type EnvironmentFormValue = Pick<SandboxEnvironment, 'configuration' | 'name'> & {
  description?: string | null;
};

interface EnvironmentFormProps {
  environment: EnvironmentFormValue;
  /**
   * Hides the name and description: a project's environment is named after
   * the project and edited as part of it.
   */
  hideBasics?: boolean;
  onSave: (params: {
    configuration?: SandboxEnvironmentSpecification;
    description?: string;
    name?: string;
  }) => Promise<void>;
  section: EnvironmentFormSection;
}

type GitSource = { kind: 'git'; path?: string; ref?: string; url: string };

/** `owner/name` of a GitHub checkout url, or nothing for any other url. */
const repositoryPathOf = (url: string) => {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url);
  return match ? { owner: match[1], repository: match[2] } : undefined;
};

/**
 * One repository the environment checks out, as one row: which repository,
 * and at a glance the branch and the folder it lands in. The branch and
 * folder fields open on Edit — with several repositories, every field laid
 * out at once read as a form to fill rather than a list of what is there.
 */
const RepositoryRow = memo<{
  busy: boolean;
  onChange: (next: Partial<Omit<GitSource, 'kind' | 'url'>>) => Promise<void>;
  onRemove: () => void;
  source: GitSource;
}>(({ busy, onChange, onRemove, source }) => {
  const { t } = useTranslation('setting');
  const [editing, setEditing] = useState(false);
  const github = repositoryPathOf(source.url);
  const label = github ? `${github.owner}/${github.repository}` : source.url;
  const summary = [
    source.ref || t('environments.form.defaultBranchShort'),
    source.path ? `${source.path}/` : t('environments.form.topFolder'),
  ].join(' · ');

  return (
    <div className={styles.item}>
      <Flexbox horizontal align={'center'} gap={12}>
        <Github size={16} />
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <Text ellipsis weight={500}>
            {label}
          </Text>
          <Text ellipsis fontSize={12} type={'secondary'}>
            {summary}
          </Text>
        </Flexbox>
        <ActionIcon
          active={editing}
          icon={editing ? ChevronUpIcon : PencilIcon}
          size={'small'}
          title={t(editing ? 'environments.form.doneEditing' : 'environments.form.editRepository')}
          onClick={() => setEditing((open) => !open)}
        />
        <ActionIcon
          icon={Trash2Icon}
          loading={busy}
          size={'small'}
          title={t('environments.form.disconnect')}
          onClick={onRemove}
        />
      </Flexbox>
      {editing && (
        <Flexbox horizontal align={'flex-start'} gap={12} style={{ marginTop: 12 }}>
          <div style={{ flex: 1 }}>
            {github ? (
              <BranchField
                owner={github.owner}
                repository={github.repository}
                value={source.ref ?? ''}
                onSave={(ref) => onChange({ ref })}
              />
            ) : (
              <InlineField
                label={t('environments.form.ref')}
                placeholder={'main'}
                value={source.ref ?? ''}
                onSave={(ref) => onChange({ ref })}
              />
            )}
          </div>
          <div style={{ flex: 1 }}>
            <InlineField
              label={t('environments.form.path')}
              placeholder={'/'}
              value={source.path ?? ''}
              onSave={(path) => onChange({ path })}
            />
          </div>
        </Flexbox>
      )}
    </div>
  );
});

RepositoryRow.displayName = 'EnvironmentRepositoryRow';

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
 * Falls back to typing when GitHub is not connected, the list could not be
 * read, or the list is only part of the repository's branches — the branch may
 * still be reachable to the build, and a field that refuses to accept a value
 * would block it for nothing.
 */
const BranchField = memo<{
  onSave: (ref: string) => Promise<void>;
  owner: string;
  repository: string;
  value: string;
}>(({ onSave, owner, repository, value }) => {
  const { t } = useTranslation('setting');
  const [editing, setEditing] = useState(false);
  // Keyed by workspace: which branches can be listed depends on that
  // workspace's GitHub App installations.
  const workspaceId = useActiveWorkspaceId();
  const { data, error, isLoading } = useSWR(
    editing ? ['sandbox-github-branches', workspaceId, owner, repository] : null,
    () => environmentService.listGithubBranches({ owner, repository }),
  );

  const canPick = !error && data?.connected !== false && !data?.truncated;

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
 * what makes it usable. An environment is a one-time initializer: the next
 * working directory it is applied to is cloned and set up from what is saved
 * here, and a folder it was already applied to is left as it is.
 *
 * Every field saves on its own the moment it is confirmed — Railway's settings
 * page is the reference. There is no draft and no save button: the old one sat
 * at the bottom of four sections, and changes typed above it were lost to a
 * tab switch before anyone scrolled down to it.
 */
const EnvironmentForm = memo<EnvironmentFormProps>(
  ({ environment, hideBasics, onSave, section }) => {
    const { t } = useTranslation('setting');
    const configuration = (environment.configuration ?? {}) as SandboxEnvironmentSpecification;
    const [pickingRepository, setPickingRepository] = useState(false);
    const [busy, setBusy] = useState(false);

    /** Write one change to the specification; the toast is the only trace a per-field save leaves. */
    const saveConfiguration = async (changes: Partial<SandboxEnvironmentSpecification>) => {
      const next = compact({ ...configuration, ...changes });
      await onSave({ configuration: next });
      toast.success(t('environments.form.saved'));
    };

    /** For controls with no confirm step of their own: a switch, a disconnect. */
    const run = async (action: () => Promise<void>) => {
      setBusy(true);
      try {
        await action();
      } catch (error) {
        toast.error(describeError(error, t, t('environments.saveFailed')));
      } finally {
        setBusy(false);
      }
    };

    // Every repository, in the order they are checked out; anything that is
    // not a git source (an old `files` one) is kept as it is.
    const sources = configuration.sources ?? [];
    const repositories = sources.filter((source): source is GitSource => source.kind === 'git');
    const otherSources = sources.filter((source) => source.kind !== 'git');
    const saveRepositories = (next: GitSource[]) =>
      saveConfiguration({ sources: [...next, ...otherSources] });

    const updateRepository = (index: number, changes: Partial<Omit<GitSource, 'kind' | 'url'>>) =>
      saveRepositories(
        repositories.map((source, at) => {
          if (at !== index) return source;
          const next = { ...source, ...changes };
          // A blank field means "the default", which is the key left out.
          if (!next.ref) delete next.ref;
          if (!next.path) delete next.path;
          return next;
        }),
      );

    // The last repository left goes back to the top of the working directory
    // when its folder was only the one it got for sitting beside another.
    const removeRepository = (index: number) =>
      run(() => {
        const rest = repositories.filter((_, at) => at !== index);
        if (rest.length === 1 && rest[0].path === repositoryFolderName(rest[0].url)) {
          const { path: _path, ...only } = rest[0];
          return saveRepositories([only]);
        }
        return saveRepositories(rest);
      });

    const [pastedUrl, setPastedUrl] = useState('');

    const pasted = parseGithubRepository(pastedUrl);

    const pastedInvalid = Boolean(pastedUrl.trim()) && !pasted;

    const addPasted = () => {
      if (!pasted) return;

      const [owner, repository] = pasted.fullName.split('/');

      addRepository({ owner, repository });

      setPastedUrl('');
    };

    const addRepository = (picked: GithubRepositorySelection | undefined) => {
      if (!picked) return;
      setPickingRepository(false);
      const url = `https://github.com/${picked.owner}/${picked.repository}`;
      if (
        repositories.some(
          (source) =>
            repositoryPathOf(source.url)?.repository === picked.repository &&
            repositoryPathOf(source.url)?.owner === picked.owner,
        )
      )
        return;
      // One repository is checked out at the top of the working directory;
      // several sit side by side, each in a folder named after it.
      void run(() =>
        saveRepositories(
          layoutRepositorySources([
            ...repositories,
            {
              kind: 'git' as const,
              url,
              ...(picked.defaultBranch && { ref: picked.defaultBranch }),
            },
          ]) as GitSource[],
        ),
      );
    };

    if (section === 'variables') {
      return (
        /* Said plainly because the shape cannot enforce it: a text field cannot
         tell a region from a token. */
        <TabPane
          desc={
            <>
              {t('environments.form.envHint')} {t('environments.form.appliesOnInit')}
            </>
          }
        >
          <EnvironmentVariables
            entries={Object.entries(configuration.env ?? {})}
            onSave={(entries) => saveConfiguration({ env: Object.fromEntries(entries) })}
          />
        </TabPane>
      );
    }

    const basics = (
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
    );

    return (
      <Flexbox>
        {!hideBasics && basics}

        <PanelSection
          desc={t('environments.form.sourcesHint')}
          icon={FolderGit2Icon}
          title={t('environments.form.sources')}
          notice={
            /* When an edit here reaches an instance, which is the question this
             panel otherwise leaves open. An instance keeps the definition it
             was created with — `configurationSnapshot`, taken once at creation
             — and a rebuild replays that one rather than reading the
             environment again. So an edit reaches new instances only, and
             saying "rebuild to apply" would send people to a button that
             cannot do it. Repeated on the setup section and the variables tab,
             which are governed by the same snapshot. */
            <Text fontSize={12} type={'secondary'}>
              {t('environments.form.appliesOnInit')}
            </Text>
          }
        >
          {repositories.length === 0 && !pickingRepository && (
            <Text fontSize={13} type={'secondary'}>
              {t('environments.form.noRepositories')}
            </Text>
          )}
          {repositories.length > 0 && (
            <Flexbox gap={8}>
              {repositories.map((source, index) => (
                <RepositoryRow
                  busy={busy}
                  key={source.url}
                  source={source}
                  onChange={(changes) => updateRepository(index, changes)}
                  onRemove={() => removeRepository(index)}
                />
              ))}
            </Flexbox>
          )}
          {pickingRepository ? (
            <Flexbox gap={8}>
              <GithubRepositoryPicker onChange={addRepository} />
              {/* Any public repository, whether or not GitHub is connected —
                  the same fallback the create dialog offers. */}
              <Flexbox gap={6}>
                <Text fontSize={12} type={'secondary'}>
                  {t('environments.form.pasteRepository')}
                </Text>
                <Flexbox horizontal gap={8}>
                  <Input
                    aria-invalid={pastedInvalid}
                    placeholder={'https://github.com/owner/repo'}
                    style={pastedInvalid ? { borderColor: cssVar.colorError } : undefined}
                    value={pastedUrl}
                    onChange={(event) => setPastedUrl(event.target.value)}
                    onPressEnter={addPasted}
                  />
                  <Button disabled={!pasted} onClick={addPasted}>
                    {t('environments.form.addPastedRepository')}
                  </Button>
                </Flexbox>
                {pastedInvalid && (
                  <Text fontSize={12} type={'danger'}>
                    {t('environments.form.repositoryUrlInvalid')}
                  </Text>
                )}
              </Flexbox>
              <Flexbox horizontal>
                <Button size={'small'} onClick={() => setPickingRepository(false)}>
                  {t('cancel', { ns: 'common' })}
                </Button>
              </Flexbox>
            </Flexbox>
          ) : (
            <Flexbox horizontal>
              <Button
                icon={<Icon icon={PlusIcon} />}
                loading={busy}
                size={'small'}
                onClick={() => setPickingRepository(true)}
              >
                {t('environments.form.addRepository')}
              </Button>
            </Flexbox>
          )}
        </PanelSection>

        <PanelSection
          last
          icon={TerminalIcon}
          title={t('environments.form.setup')}
          notice={
            <Text fontSize={12} type={'secondary'}>
              {t('environments.form.appliesOnInit')}
            </Text>
          }
        >
          {repositories.length > 1 && (
            <Text fontSize={12} type={'secondary'}>
              {t('environments.form.bootstrapMultiRepo', {
                example: `cd ${repositories[0].path ?? repositoryFolderName(repositories[0].url)} && pnpm install`,
              })}
            </Text>
          )}
          <InlineField
            multiline
            desc={t('environments.form.bootstrapHint')}
            label={t('environments.form.bootstrap')}
            placeholder={'pnpm install'}
            value={configuration.bootstrapCommand ?? ''}
            onSave={(bootstrapCommand) => saveConfiguration({ bootstrapCommand })}
          />
        </PanelSection>
      </Flexbox>
    );
  },
);

EnvironmentForm.displayName = 'EnvironmentForm';

export default EnvironmentForm;
