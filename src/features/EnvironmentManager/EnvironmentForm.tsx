'use client';

import { Flexbox, Icon, TextArea } from '@lobehub/ui';
import { ActionIcon, Button, Input, Switch, Text } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import {
  FolderGit2Icon,
  HardDriveIcon,
  InfoIcon,
  KeyRoundIcon,
  PlusIcon,
  TerminalIcon,
  Trash2Icon,
} from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SandboxEnvironmentSpecification } from '@/services/sandboxWorkspace';

import GithubRepositoryPicker, { type GithubRepositorySelection } from './GithubRepositoryPicker';
import PanelSection from './PanelSection';
import type { SandboxEnvironment } from './useEnvironmentData';

/**
 * One labelled control. Extracted because a section holds several and they were
 * each five lines of the same three elements, which buried the one line that
 * differed.
 */
const Field = memo<{ children: ReactNode; desc?: ReactNode; label: ReactNode }>(
  ({ children, desc, label }) => (
    <Flexbox gap={6}>
      <Text fontSize={12} type={'secondary'} weight={500}>
        {label}
      </Text>
      {desc && (
        <Text fontSize={12} type={'secondary'}>
          {desc}
        </Text>
      )}
      {children}
    </Flexbox>
  ),
);

Field.displayName = 'EnvironmentFormField';

interface EnvironmentFormProps {
  environment: SandboxEnvironment;
  onSave: (params: {
    configuration: SandboxEnvironmentSpecification;
    description: string;
    name: string;
  }) => Promise<void>;
}

interface GitSource {
  path?: string;
  ref?: string;
  url: string;
}

/**
 * Network access is on unless someone says otherwise, and an untouched form
 * writes nothing rather than pinning the default into the stored specification.
 */
const DEFAULT_INTERNET_ACCESS = true;

interface FormState {
  bootstrapCommand: string;
  env: [string, string][];
  excludePaths: string;
  internetAccess: boolean;
  maintenanceCommand: string;
  sources: GitSource[];
}

const toFormState = (configuration: SandboxEnvironmentSpecification): FormState => ({
  bootstrapCommand: configuration.bootstrapCommand ?? '',
  env: Object.entries(configuration.env ?? {}),
  // One path per line: a list of paths is a list of lines everywhere else a
  // person meets one, and a row editor buys nothing for values this short.
  excludePaths: (configuration.excludePaths ?? []).join('\n'),
  internetAccess: configuration.internetAccess ?? DEFAULT_INTERNET_ACCESS,
  maintenanceCommand: configuration.maintenanceCommand ?? '',
  sources: (configuration.sources ?? []).map(({ path, ref, url }) => ({ path, ref, url })),
});

/**
 * Empty rows are how a form lets someone start typing; they are not part of the
 * specification, so they drop out on the way back rather than being stored as
 * blanks that fail validation on the next save.
 */
const toSpecification = (state: FormState): SandboxEnvironmentSpecification => {
  const sources = state.sources
    .filter((source) => source.url.trim())
    .map(({ path, ref, url }) => ({
      kind: 'git' as const,
      ...(path?.trim() && { path: path.trim() }),
      ...(ref?.trim() && { ref: ref.trim() }),
      url: url.trim(),
    }));
  const env = state.env.filter(([key]) => key.trim()).map(([key, value]) => [key.trim(), value]);
  const excludePaths = state.excludePaths
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    ...(state.bootstrapCommand.trim() && { bootstrapCommand: state.bootstrapCommand.trim() }),
    ...(env.length > 0 && { env: Object.fromEntries(env) }),
    ...(excludePaths.length > 0 && { excludePaths }),
    ...(state.maintenanceCommand.trim() && {
      maintenanceCommand: state.maintenanceCommand.trim(),
    }),
    ...(state.internetAccess !== DEFAULT_INTERNET_ACCESS && {
      internetAccess: state.internetAccess,
    }),
    ...(sources.length > 0 && { sources }),
  };
};

/**
 * An environment's specification: where its source material comes from and what
 * makes it usable. This is the record of what the environment IS; what a sandbox
 * has built from it is a cache, which is why editing here marks every working
 * copy as needing a rebuild rather than changing one.
 *
 * Saved explicitly rather than on blur, for that same reason — a field that
 * invalidates every copy the moment focus leaves it is a field people are
 * afraid to click into.
 */
const EnvironmentForm = memo<EnvironmentFormProps>(({ environment, onSave }) => {
  const { t } = useTranslation('setting');
  const configuration = (environment.configuration ?? {}) as SandboxEnvironmentSpecification;

  // What was last written, so the save affordance can go away once it has been.
  // Re-deriving this from props would not do: the row does not remount after a
  // save, so an initializer would keep comparing against the specification as it
  // stood when the page opened and the form would claim unsaved changes forever.
  const [saved, setSaved] = useState(() => ({
    configuration: toSpecification(toFormState(configuration)),
    description: environment.description ?? '',
    name: environment.name,
  }));
  const [state, setState] = useState<FormState>(() => toFormState(configuration));
  const [description, setDescription] = useState(environment.description ?? '');
  const [name, setName] = useState(environment.name);
  const [saving, setSaving] = useState(false);

  const trimmedName = name.trim();
  const next = toSpecification(state);
  const dirty =
    !isEqual(next, saved.configuration) ||
    description !== saved.description ||
    trimmedName !== saved.name;

  const patch = (changes: Partial<FormState>) =>
    setState((current) => ({ ...current, ...changes }));
  const updateSource = (index: number, change: Partial<GitSource>) =>
    patch({
      sources: state.sources.map((source, at) =>
        at === index ? { ...source, ...change } : source,
      ),
    });

  const source = state.sources[0];

  // The picker speaks in owner/name; the specification stores a checkout URL.
  // Translating at this boundary keeps the stored shape the execution plane's
  // and the chosen shape the person's.
  const selection = (() => {
    const path = source?.url?.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
    const [owner, repository] = path?.split('/') ?? [];

    return owner && repository ? { defaultBranch: source?.ref, owner, repository } : undefined;
  })();

  const pickRepository = (picked: GithubRepositorySelection | undefined) =>
    patch({
      sources: picked
        ? [
            {
              // A source the person just chose keeps whatever folder they had
              // set, but takes the new repository's default branch — the old
              // branch belonged to the old repository.
              path: source?.path,
              ref: picked.defaultBranch,
              url: `https://github.com/${picked.owner}/${picked.repository}`,
            },
          ]
        : [],
    });

  const save = async () => {
    // A nameless environment is not a thing anyone can pick out of a list, and
    // the name is the one field with no sensible empty value — so the save is
    // refused rather than silently storing a blank.
    if (!trimmedName) return;
    setSaving(true);
    try {
      await onSave({ configuration: next, description, name: trimmedName });
      setSaved({ configuration: next, description, name: trimmedName });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Flexbox>
      <PanelSection
        desc={t('environments.form.desc')}
        icon={InfoIcon}
        title={t('environments.form.basics')}
      >
        <Field label={t('environments.nameLabel')}>
          <Input
            placeholder={t('environments.namePlaceholder')}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label={t('environments.form.description')}>
          <Input
            placeholder={t('environments.form.descriptionPlaceholder')}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
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
        {/* One repository, so no list and no way to add a second. The same
            picker the create dialog uses, so the two agree on what choosing a
            repository looks like; branch and folder stay free text because
            they narrow a choice already made rather than making one. */}
        <GithubRepositoryPicker value={selection} onChange={pickRepository} />

        {source && (
          <Flexbox horizontal align={'center'} gap={8}>
            <Input
              placeholder={t('environments.form.ref')}
              style={{ flex: 1 }}
              value={source.ref ?? ''}
              onChange={(event) => updateSource(0, { ref: event.target.value })}
            />
            <Input
              placeholder={t('environments.form.path')}
              style={{ flex: 1 }}
              value={source.path ?? ''}
              onChange={(event) => updateSource(0, { path: event.target.value })}
            />
          </Flexbox>
        )}
      </PanelSection>

      <PanelSection icon={TerminalIcon} title={t('environments.form.setup')}>
        <Field desc={t('environments.form.bootstrapHint')} label={t('environments.form.bootstrap')}>
          <TextArea
            autoSize={{ maxRows: 10, minRows: 3 }}
            placeholder={'pnpm install'}
            value={state.bootstrapCommand}
            onChange={(event) => patch({ bootstrapCommand: event.target.value })}
          />
        </Field>
        <Field
          desc={t('environments.form.maintenanceHint')}
          label={t('environments.form.maintenance')}
        >
          <TextArea
            autoSize={{ maxRows: 6, minRows: 2 }}
            placeholder={'git pull --ff-only'}
            value={state.maintenanceCommand}
            onChange={(event) => patch({ maintenanceCommand: event.target.value })}
          />
        </Field>
      </PanelSection>

      <PanelSection
        /* Said plainly because the shape cannot enforce it: a text field cannot
           tell a region from a token. */
        desc={t('environments.form.envHint')}
        icon={KeyRoundIcon}
        title={t('environments.form.env')}
      >
        {state.env.map(([key, value], index) => (
          <Flexbox horizontal align={'center'} gap={8} key={index}>
            <Input
              placeholder={'NODE_ENV'}
              style={{ flex: 1 }}
              value={key}
              onChange={(event) =>
                patch({
                  env: state.env.map((pair, at) =>
                    at === index ? [event.target.value, pair[1]] : pair,
                  ),
                })
              }
            />
            <Input
              placeholder={'production'}
              style={{ flex: 1 }}
              value={value}
              onChange={(event) =>
                patch({
                  env: state.env.map((pair, at) =>
                    at === index ? [pair[0], event.target.value] : pair,
                  ),
                })
              }
            />
            <ActionIcon
              icon={Trash2Icon}
              size={'small'}
              title={t('environments.form.removeEnv')}
              onClick={() => patch({ env: state.env.filter((_, at) => at !== index) })}
            />
          </Flexbox>
        ))}
        <Flexbox horizontal>
          <Button
            icon={<Icon icon={PlusIcon} />}
            size={'small'}
            onClick={() => patch({ env: [...state.env, ['', '']] })}
          >
            {t('environments.form.addEnv')}
          </Button>
        </Flexbox>
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
            checked={state.internetAccess}
            onChange={(internetAccess) => patch({ internetAccess })}
          />
        </Flexbox>
        <Field desc={t('environments.form.excludeHint')} label={t('environments.form.exclude')}>
          <TextArea
            autoSize={{ maxRows: 8, minRows: 2 }}
            placeholder={'dist\n.cache'}
            value={state.excludePaths}
            onChange={(event) => patch({ excludePaths: event.target.value })}
          />
        </Field>
      </PanelSection>

      {dirty && (
        <Flexbox horizontal align={'center'} gap={12} justify={'flex-end'}>
          <Text fontSize={12} type={'secondary'}>
            {t('environments.form.staleWarning')}
          </Text>
          <Button
            disabled={!trimmedName}
            loading={saving}
            size={'small'}
            type={'primary'}
            onClick={save}
          >
            {t('environments.form.save')}
          </Button>
        </Flexbox>
      )}
    </Flexbox>
  );
});

EnvironmentForm.displayName = 'EnvironmentForm';

export default EnvironmentForm;
