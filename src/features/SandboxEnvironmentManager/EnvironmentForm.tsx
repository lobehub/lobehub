'use client';

import { Flexbox, Icon, TextArea } from '@lobehub/ui';
import { ActionIcon, Button, Input, Switch, Text } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SandboxEnvironmentSpecification } from '@/services/sandboxWorkspace';

import type { SandboxEnvironment } from './useEnvironmentData';

interface EnvironmentFormProps {
  environment: SandboxEnvironment;
  onSave: (params: {
    configuration: SandboxEnvironmentSpecification;
    description: string;
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

  const [baseline] = useState(() => toSpecification(toFormState(configuration)));
  const [state, setState] = useState<FormState>(() => toFormState(configuration));
  const [description, setDescription] = useState(environment.description ?? '');
  const [saving, setSaving] = useState(false);

  const next = toSpecification(state);
  const dirty = !isEqual(next, baseline) || description !== (environment.description ?? '');

  const patch = (changes: Partial<FormState>) =>
    setState((current) => ({ ...current, ...changes }));
  const updateSource = (index: number, change: Partial<GitSource>) =>
    patch({
      sources: state.sources.map((source, at) =>
        at === index ? { ...source, ...change } : source,
      ),
    });

  const save = async () => {
    setSaving(true);
    try {
      await onSave({ configuration: next, description });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Flexbox gap={20} paddingBlock={8}>
      <Flexbox gap={6}>
        <Text fontSize={12} type={'secondary'} weight={500}>
          {t('sandboxEnvironments.form.description')}
        </Text>
        <Input
          placeholder={t('sandboxEnvironments.form.descriptionPlaceholder')}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Flexbox>

      <Flexbox gap={6}>
        <Text fontSize={12} type={'secondary'} weight={500}>
          {t('sandboxEnvironments.form.sources')}
        </Text>
        <Text fontSize={12} type={'secondary'}>
          {t('sandboxEnvironments.form.sourcesHint')}
        </Text>
        {state.sources.map((source, index) => (
          <Flexbox horizontal align={'center'} gap={8} key={index}>
            <Input
              placeholder={'https://github.com/owner/repo.git'}
              style={{ flex: 2 }}
              value={source.url}
              onChange={(event) => updateSource(index, { url: event.target.value })}
            />
            <Input
              placeholder={t('sandboxEnvironments.form.ref')}
              style={{ flex: 1 }}
              value={source.ref ?? ''}
              onChange={(event) => updateSource(index, { ref: event.target.value })}
            />
            <Input
              placeholder={t('sandboxEnvironments.form.path')}
              style={{ flex: 1 }}
              value={source.path ?? ''}
              onChange={(event) => updateSource(index, { path: event.target.value })}
            />
            <ActionIcon
              icon={Trash2Icon}
              size={'small'}
              title={t('sandboxEnvironments.form.removeSource')}
              onClick={() => patch({ sources: state.sources.filter((_, at) => at !== index) })}
            />
          </Flexbox>
        ))}
        <Flexbox horizontal>
          <Button
            icon={<Icon icon={PlusIcon} />}
            size={'small'}
            onClick={() => patch({ sources: [...state.sources, { url: '' }] })}
          >
            {t('sandboxEnvironments.form.addSource')}
          </Button>
        </Flexbox>
      </Flexbox>

      <Flexbox gap={6}>
        <Text fontSize={12} type={'secondary'} weight={500}>
          {t('sandboxEnvironments.form.bootstrap')}
        </Text>
        <Text fontSize={12} type={'secondary'}>
          {t('sandboxEnvironments.form.bootstrapHint')}
        </Text>
        <TextArea
          autoSize={{ maxRows: 10, minRows: 3 }}
          placeholder={'pnpm install'}
          value={state.bootstrapCommand}
          onChange={(event) => patch({ bootstrapCommand: event.target.value })}
        />
      </Flexbox>

      <Flexbox gap={6}>
        <Text fontSize={12} type={'secondary'} weight={500}>
          {t('sandboxEnvironments.form.maintenance')}
        </Text>
        <Text fontSize={12} type={'secondary'}>
          {t('sandboxEnvironments.form.maintenanceHint')}
        </Text>
        <TextArea
          autoSize={{ maxRows: 6, minRows: 2 }}
          placeholder={'git pull --ff-only'}
          value={state.maintenanceCommand}
          onChange={(event) => patch({ maintenanceCommand: event.target.value })}
        />
      </Flexbox>

      <Flexbox gap={6}>
        <Text fontSize={12} type={'secondary'} weight={500}>
          {t('sandboxEnvironments.form.exclude')}
        </Text>
        <Text fontSize={12} type={'secondary'}>
          {t('sandboxEnvironments.form.excludeHint')}
        </Text>
        <TextArea
          autoSize={{ maxRows: 8, minRows: 2 }}
          placeholder={'dist\n.cache'}
          value={state.excludePaths}
          onChange={(event) => patch({ excludePaths: event.target.value })}
        />
      </Flexbox>

      <Flexbox gap={6}>
        <Text fontSize={12} type={'secondary'} weight={500}>
          {t('sandboxEnvironments.form.env')}
        </Text>
        {/* Said plainly because the shape cannot enforce it: a text field cannot
            tell a region from a token. */}
        <Text fontSize={12} type={'secondary'}>
          {t('sandboxEnvironments.form.envHint')}
        </Text>
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
              title={t('sandboxEnvironments.form.removeEnv')}
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
            {t('sandboxEnvironments.form.addEnv')}
          </Button>
        </Flexbox>
      </Flexbox>

      <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
        <Flexbox gap={2}>
          <Text fontSize={12} weight={500}>
            {t('sandboxEnvironments.form.internetAccess')}
          </Text>
          <Text fontSize={12} type={'secondary'}>
            {t('sandboxEnvironments.form.internetAccessHint')}
          </Text>
        </Flexbox>
        <Switch
          checked={state.internetAccess}
          onChange={(internetAccess) => patch({ internetAccess })}
        />
      </Flexbox>

      {dirty && (
        <Flexbox horizontal align={'center'} gap={12} justify={'flex-end'}>
          <Text fontSize={12} type={'secondary'}>
            {t('sandboxEnvironments.form.staleWarning')}
          </Text>
          <Button loading={saving} size={'small'} type={'primary'} onClick={save}>
            {t('sandboxEnvironments.form.save')}
          </Button>
        </Flexbox>
      )}
    </Flexbox>
  );
});

EnvironmentForm.displayName = 'EnvironmentForm';

export default EnvironmentForm;
