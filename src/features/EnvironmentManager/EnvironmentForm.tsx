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
  FolderIcon,
  GitBranchIcon,
  PencilIcon,
  PlusIcon,
  TerminalIcon,
  Trash2Icon,
} from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
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
}

type GitSource = {
  kind: 'git';
  path?: string;
  ref?: string;
  setupCommand?: string;
  url: string;
};

/** `owner/name` of a GitHub checkout url, or nothing for any other url. */
const repositoryPathOf = (url: string) => {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url);
  return match ? { owner: match[1], repository: match[2] } : undefined;
};

/**
 * One repository the environment checks out, as one row: which repository,
 * and at a glance the branch, the folder it lands in and its own setup. The
 * fields open on Edit — with several repositories, every field laid out at
 * once read as a form to fill rather than a list of what is there.
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
  // One line: the name, then each setting as an icon and its value. The
  // default branch says nothing worth a word, so it shows only when one is set.
  const facts = [
    ...(source.ref
      ? [{ icon: GitBranchIcon, title: t('environments.form.ref'), value: source.ref }]
      : []),
    ...(source.path
      ? [{ icon: FolderIcon, title: t('environments.form.path'), value: `${source.path}/` }]
      : []),
    ...(source.setupCommand
      ? [
          {
            icon: TerminalIcon,
            title: t('environments.form.bootstrap'),
            value: source.setupCommand.split('\n')[0],
          },
        ]
      : []),
  ];

  return (
    <div className={styles.item}>
      <Flexbox horizontal align={'center'} gap={12}>
        <Github size={16} />
        <Flexbox horizontal align={'center'} flex={1} gap={16} style={{ minWidth: 0 }}>
          <Text ellipsis style={{ flex: 'none', maxWidth: '50%' }} weight={500}>
            {label}
          </Text>
          {facts.map((fact) => (
            <Flexbox
              horizontal
              align={'center'}
              gap={4}
              key={fact.title}
              style={{ color: cssVar.colorTextSecondary, minWidth: 0 }}
              title={fact.title}
            >
              <Icon icon={fact.icon} size={13} style={{ flex: 'none' }} />
              <Text ellipsis fontSize={12} type={'secondary'}>
                {fact.value}
              </Text>
            </Flexbox>
          ))}
        </Flexbox>
        <ActionIcon
          active={editing}
          icon={editing ? ChevronUpIcon : PencilIcon}
          size={'small'}
          title={t(
            editing ? 'environments.form.doneEditing' : 'environments.form.editRepositorySettings',
          )}
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
        <Flexbox gap={12} style={{ marginTop: 12 }}>
          <Flexbox horizontal align={'flex-start'} gap={12}>
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
          <InlineField
            multiline
            desc={t('environments.form.repositorySetupHint')}
            label={t('environments.form.bootstrap')}
            placeholder={'pnpm install'}
            value={source.setupCommand ?? ''}
            onSave={(setupCommand) => onChange({ setupCommand })}
          />
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
 * An environment's specification, laid out flat in one column: basics, the
 * repositories it checks out (each with its own setup), the setup that runs
 * after them, and the variables every command sees. Shared by an environment's
 * own page and a project's environment page.
 *
 * An environment is a one-time initializer: the next
 * working directory it is applied to is cloned and set up from what is saved
 * here, and a folder it was already applied to is left as it is.
 *
 * Every field saves on its own the moment it is confirmed — Railway's settings
 * page is the reference. There is no draft and no save button: the old one sat
 * at the bottom of four sections, and changes typed above it were lost to a
 * tab switch before anyone scrolled down to it.
 */
const EnvironmentForm = memo<EnvironmentFormProps>(({ environment, hideBasics, onSave }) => {
  const { t } = useTranslation('setting');
  const configuration = (environment.configuration ?? {}) as SandboxEnvironmentSpecification;
  const [pickingRepository, setPickingRepository] = useState(false);
  const [busy, setBusy] = useState(false);

  // Every field saves the whole specification, so two saves in flight at once
  // would each start from the same snapshot and the later one would undo the
  // earlier. Saves run one after another, each on top of the last one saved;
  // while none is running, the snapshot follows what the server returned.
  const latest = useRef(configuration);
  const pending = useRef(0);
  const queue = useRef<Promise<unknown> | undefined>(undefined);
  const stored = environment.configuration;
  useEffect(() => {
    if (pending.current === 0) latest.current = (stored ?? {}) as SandboxEnvironmentSpecification;
  }, [stored]);

  type Changes = Partial<SandboxEnvironmentSpecification>;

  /** Write one change to the specification; the toast is the only trace a per-field save leaves. */
  const saveConfiguration = async (
    changes: Changes | ((current: SandboxEnvironmentSpecification) => Changes),
  ) => {
    pending.current++;
    const task = (queue.current ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const current = latest.current;
        const next = compact({
          ...current,
          ...(typeof changes === 'function' ? changes(current) : changes),
        });
        await onSave({ configuration: next });
        latest.current = next;
      })
      .finally(() => {
        pending.current--;
      });
    queue.current = task;
    await task;
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
  /** Rewrites the repositories as they stand when the save runs, keeping other sources. */
  const saveRepositories = (update: (current: GitSource[]) => GitSource[]) =>
    saveConfiguration((current) => {
      const all = current.sources ?? [];
      const git = all.filter((source): source is GitSource => source.kind === 'git');
      return { sources: [...update(git), ...all.filter((source) => source.kind !== 'git')] };
    });

  const folderOf = (path: string | undefined) =>
    path
      ?.trim()
      .replace(/^\.?\/+/, '')
      .replace(/\/+$/, '') || undefined;

  const updateRepository = (url: string, changes: Partial<Omit<GitSource, 'kind' | 'url'>>) => {
    // Two checkouts in one folder would merge into each other.
    const folder = changes.path === undefined ? undefined : folderOf(changes.path);
    if (
      folder &&
      repositories.some((source) => source.url !== url && folderOf(source.path) === folder)
    )
      return Promise.reject(new Error(t('environments.form.duplicateFolder')));

    return saveRepositories((current) =>
      current.map((source) => {
        if (source.url !== url) return source;
        const next = { ...source, ...changes };
        // A blank field means "the default", which is the key left out.
        if (!next.ref) delete next.ref;
        if (!next.path) delete next.path;
        if (!next.setupCommand?.trim()) delete next.setupCommand;
        return next;
      }),
    );
  };

  // The last repository left goes back to the top of the working directory
  // when its folder was only the one it got for sitting beside another.
  const removeRepository = (url: string) =>
    run(() =>
      saveRepositories((current) => {
        const rest = current.filter((source) => source.url !== url);
        if (rest.length === 1 && rest[0].path === repositoryFolderName(rest[0].url)) {
          const { path: _path, ...only } = rest[0];
          return [only];
        }
        return rest;
      }),
    );

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
        (current) =>
          layoutRepositorySources([
            ...current,
            {
              kind: 'git' as const,
              url,
              ...(picked.defaultBranch && { ref: picked.defaultBranch }),
            },
          ]) as GitSource[],
      ),
    );
  };

  const basics = (
    <PanelSection title={t('environments.form.basics')}>
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
        title={t('environments.form.sources')}
        notice={
          /* When an edit here reaches an instance, which is the question this
             panel otherwise leaves open. An instance keeps the definition it
             was created with — `configurationSnapshot`, taken once at creation
             — and a rebuild replays that one rather than reading the
             environment again. So an edit reaches new instances only, and
             saying "rebuild to apply" would send people to a button that
             cannot do it. Said once, here at the top: setup and variables are
             governed by the same snapshot. */
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
            {repositories.map((source) => (
              <RepositoryRow
                busy={busy}
                key={source.url}
                source={source}
                onChange={(changes) => updateRepository(source.url, changes)}
                onRemove={() => removeRepository(source.url)}
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
        title={t('environments.form.setup')}
        desc={
          repositories.length > 0 ? t('environments.form.bootstrapAfterRepositories') : undefined
        }
      >
        <InlineField
          multiline
          desc={t('environments.form.bootstrapHint')}
          label={t('environments.form.bootstrap')}
          placeholder={'pnpm install'}
          value={configuration.bootstrapCommand ?? ''}
          onSave={(bootstrapCommand) => saveConfiguration({ bootstrapCommand })}
        />
      </PanelSection>

      {/* Said plainly because the shape cannot enforce it: a text field
            cannot tell a region from a token. */}
      <PanelSection desc={t('environments.form.envHint')} title={t('environments.form.env')}>
        <EnvironmentVariables
          entries={Object.entries(configuration.env ?? {})}
          onSave={(entries) => saveConfiguration({ env: Object.fromEntries(entries) })}
        />
      </PanelSection>
    </Flexbox>
  );
});

EnvironmentForm.displayName = 'EnvironmentForm';

export default EnvironmentForm;
