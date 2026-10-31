'use client';

import type { EvalCaseEnvironment, EvalMemoryFixture } from '@lobechat/types';
import {
  Block,
  Button,
  confirmModal,
  Drawer,
  Empty,
  Flexbox,
  Input,
  Segmented,
  Select,
  Switch,
  Tag,
  Text,
  TextArea,
  toast,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Plus } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isBuiltInRow } from '@/features/LobeBench/lobeBench';
import { useClientDataSWR } from '@/libs/swr';
import { agentEvalService } from '@/services/agentEval';

const styles = stylex.create({
  container: {
    overflowY: 'auto',
    paddingBlockStart: 56,
    paddingBlockEnd: 32,
    paddingInline: 32,
  },
  table: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 2fr) 120px',
    columnGap: 12,
    alignItems: 'center',
  },
  head: {
    paddingBlock: 8,
    paddingInline: 12,
    fontSize: 12,
    color: cssVar.colorTextSecondary,
  },
  row: {
    cursor: 'pointer',
    paddingBlock: 10,
    paddingInline: 12,
    borderRadius: cssVar.borderRadius,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
  },
  mono: { fontFamily: cssVar.fontFamilyCode, fontVariantNumeric: 'tabular-nums' },
});

interface EnvironmentRow {
  config: EvalCaseEnvironment;
  description?: string | null;
  id: string;
  identifier?: string | null;
  metadata?: Record<string, unknown> | null;
  name: string;
  testCaseCount?: number;
  /** Null for a built-in environment (one of the product's own case sets). */
  userId?: string | null;
}

type Effort = 'high' | 'low' | 'medium';
type Permission = 'read-only' | 'read-write';

const joinList = (list?: string[]) => (list ?? []).join(', ');
const splitList = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

/** A valid seed fixture in the shape the native Memory schemas expect. */
const MEMORY_TEMPLATE: EvalMemoryFixture = {
  contexts: [
    {
      details: 'The user is training for a 10 km race in November.',
      memoryCategory: 'fitness',
      memoryType: 'context',
      sourceIds: [],
      summary: 'Training for a 10 km race in November',
      tags: ['running', 'race'],
      title: 'Training for a 10 km race',
      withContext: {
        associatedObjects: [],
        associatedSubjects: [],
        currentStatus: 'ongoing',
        description: 'The user is training for a 10 km race in November.',
        labels: ['running', 'race'],
        scoreImpact: 0.6,
        scoreUrgency: 0.5,
        title: 'Training for a 10 km race',
        type: 'ongoing',
      },
    },
  ],
  persona: { narrative: 'A runner who trains three mornings a week.', tagline: 'morning runner' },
  preferences: [
    {
      details: 'Prefers short, numbered plans over long explanations.',
      memoryCategory: 'format',
      memoryType: 'preference',
      sourceIds: [],
      summary: 'Prefers short, numbered plans',
      tags: ['format', 'plans'],
      title: 'Prefers short, numbered plans',
      withPreference: {
        appContext: null,
        conclusionDirectives: 'Give plans as short numbered lists, one line per step.',
        extractedLabels: ['format', 'plans'],
        extractedScopes: [],
        originContext: null,
        scorePriority: 0.8,
        suggestions: [],
        type: 'personal',
      },
    },
  ],
  seededAt: '2026-07-20T09:00:00Z',
};

/**
 * Reusable case environments: the persona, tools, Memory, clock and mock
 * connectors many cases share. A case points at one and may override a few
 * fields; changing an environment changes every case that uses it.
 */
const LobeBenchEnvironments = memo(() => {
  const { t } = useTranslation('eval');
  const {
    data: environments,
    isLoading,
    mutate: refresh,
  } = useClientDataSWR<EnvironmentRow[]>(
    'lobe-bench/environments',
    () => agentEvalService.listEnvironments() as Promise<EnvironmentRow[]>,
  );
  const [editing, setEditing] = useState<{ row?: EnvironmentRow } | undefined>();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [persona, setPersona] = useState('');
  const [agentName, setAgentName] = useState('');
  const [plugins, setPlugins] = useState('');
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [memoryEffort, setMemoryEffort] = useState<Effort>('medium');
  const [memoryPermission, setMemoryPermission] = useState<Permission>('read-only');
  const [memoryJson, setMemoryJson] = useState('');
  const [sessionDate, setSessionDate] = useState('');
  const [timezone, setTimezone] = useState('');
  const [envPrompt, setEnvPrompt] = useState('');
  const [mockServices, setMockServices] = useState('');
  const [saving, setSaving] = useState(false);

  // The drawer shows the environment being edited, or empty fields for a new one.
  useEffect(() => {
    if (!editing) return;
    const config = editing.row?.config ?? {};
    setName(editing.row?.name ?? '');
    setDescription(editing.row?.description ?? '');
    setPersona(config.agent?.systemRole ?? '');
    setAgentName(config.agent?.name ?? '');
    setPlugins(joinList(config.agent?.plugins));
    setMemoryEnabled(config.agent?.memory?.enabled ?? false);
    setMemoryEffort((config.agent?.memory?.effort as Effort | undefined) ?? 'medium');
    setMemoryPermission(config.agent?.memory?.toolPermission ?? 'read-only');
    setMemoryJson(config.memory ? JSON.stringify(config.memory, null, 2) : '');
    setSessionDate(config.sessionDate ?? '');
    setTimezone(config.timezone ?? '');
    setEnvPrompt(config.envPrompt ?? '');
    setMockServices(joinList(config.mock?.services));
  }, [editing]);

  // A rejected save names each bad field: the server answers with the
  // validator's issue list, which reads badly as one JSON line.
  const fail = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const issues = JSON.parse(message) as Array<{ message?: string; path?: unknown[] }>;
      if (Array.isArray(issues) && issues.length > 0) {
        toast.error(
          issues
            .slice(0, 6)
            .map((issue) => `${(issue.path ?? []).join('.')}: ${issue.message ?? ''}`)
            .join('\n'),
        );
        return;
      }
    } catch {
      /* not a validator answer */
    }
    toast.error(message);
  };

  const buildConfig = (): EvalCaseEnvironment | undefined => {
    if (sessionDate.trim() && Number.isNaN(Date.parse(sessionDate.trim()))) {
      toast.error(t('lobeBench.case.editor.invalidDate'));
      return;
    }
    let memory: EvalMemoryFixture | undefined;
    if (memoryJson.trim()) {
      try {
        const parsed = JSON.parse(memoryJson);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          throw new Error('object');
        memory = parsed as EvalMemoryFixture;
      } catch {
        toast.error(t('lobeBench.environments.editor.memory.invalid'));
        return;
      }
    }
    const pluginList = splitList(plugins);
    const services = splitList(mockServices);
    const agent = {
      ...(agentName.trim() && { name: agentName.trim() }),
      ...(memoryEnabled && {
        memory: { effort: memoryEffort, enabled: true, toolPermission: memoryPermission },
      }),
      ...(plugins.trim() && { plugins: pluginList }),
      ...(persona.trim() && { systemRole: persona.trim() }),
    };
    return {
      ...(Object.keys(agent).length > 0 && { agent }),
      ...(envPrompt.trim() && { envPrompt: envPrompt.trim() }),
      ...(memory && { memory }),
      ...(services.length > 0 && { mock: { services } }),
      ...(sessionDate.trim() && { sessionDate: sessionDate.trim() }),
      ...(timezone.trim() && { timezone: timezone.trim() }),
    };
  };

  const save = async () => {
    if (!name.trim()) return;
    const config = buildConfig();
    if (!config) return;
    setSaving(true);
    try {
      if (editing?.row) {
        await agentEvalService.updateEnvironment({
          config,
          description: description.trim() || null,
          id: editing.row.id,
          name: name.trim(),
        });
      } else {
        await agentEvalService.createEnvironment({
          config,
          description: description.trim() || undefined,
          identifier: `env-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          name: name.trim(),
        });
      }
      await refresh();
      toast.success(t('lobeBench.environments.editor.saved'));
      setEditing(undefined);
    } catch (error) {
      fail(error);
    } finally {
      setSaving(false);
    }
  };

  const duplicate = () => {
    if (!editing?.row) return;
    setEditing({
      row: {
        ...editing.row,
        id: '',
        name: `${editing.row.name} (copy)`,
        testCaseCount: 0,
      },
    });
    // A duplicate is a new environment: clear the id so saving creates it.
    setEditing((state) => (state?.row ? { row: { ...state.row, id: '' } } : state));
  };

  const remove = () => {
    const row = editing?.row;
    if (!row?.id) return;
    confirmModal({
      content: t('lobeBench.environments.delete.confirm', { count: row.testCaseCount ?? 0 }),
      okButtonProps: { danger: true },
      okText: t('lobeBench.case.delete'),
      onOk: async () => {
        try {
          await agentEvalService.deleteEnvironment(row.id);
          await refresh();
          setEditing(undefined);
        } catch (error) {
          fail(error);
        }
      },
      title: t('lobeBench.case.delete'),
    });
  };

  const isNew = !editing?.row?.id;
  const usedBy = editing?.row?.testCaseCount ?? 0;
  // A built-in environment is shown as is; "Duplicate" makes an editable copy.
  const readOnly = !isNew && isBuiltInRow(editing?.row);

  return (
    <Flexbox className={stylex.props(styles.container).className} flex={1} gap={20}>
      <Flexbox horizontal align={'flex-start'} gap={16} justify={'space-between'}>
        <Flexbox gap={4}>
          <Text as={'h1'} fontSize={24} weight={600}>
            {t('lobeBench.environments.title')}
          </Text>
          <Text type={'secondary'}>{t('lobeBench.environments.subtitle')}</Text>
        </Flexbox>
        <Button icon={Plus} type={'primary'} onClick={() => setEditing({})}>
          {t('lobeBench.environments.new')}
        </Button>
      </Flexbox>

      <Block padding={8} variant={'outlined'}>
        <Flexbox gap={2}>
          <div className={stylex.props(styles.table, styles.head).className}>
            <span>{t('lobeBench.environments.col.name')}</span>
            <span>{t('lobeBench.environments.col.setup')}</span>
            <span style={{ textAlign: 'right' }}>{t('lobeBench.environments.col.cases')}</span>
          </div>
          {!isLoading && (environments?.length ?? 0) === 0 && (
            <Empty description={t('lobeBench.environments.empty')} />
          )}
          {(environments ?? []).map((row) => {
            const config = row.config ?? {};
            const parts = [
              config.agent?.plugins?.length
                ? t('lobeBench.environments.setup.tools', { count: config.agent.plugins.length })
                : undefined,
              config.agent?.memory?.enabled
                ? t('lobeBench.environments.setup.memory', {
                    permission: config.agent.memory.toolPermission ?? 'read-only',
                  })
                : undefined,
              config.sessionDate
                ? t('lobeBench.environments.setup.clock', { date: config.sessionDate })
                : undefined,
              config.mock?.services?.length
                ? t('lobeBench.environments.setup.mock', { count: config.mock.services.length })
                : undefined,
            ].filter(Boolean);
            return (
              <div
                className={stylex.props(styles.table, styles.row).className}
                key={row.id}
                onClick={() => setEditing({ row })}
              >
                <Flexbox gap={2} style={{ minWidth: 0 }}>
                  <Flexbox horizontal align={'center'} gap={6}>
                    <Text ellipsis weight={500}>
                      {row.name}
                    </Text>
                    {isBuiltInRow(row) && <Tag>{t('lobeBench.builtIn')}</Tag>}
                  </Flexbox>
                  {row.description && (
                    <Text ellipsis fontSize={12} type={'secondary'}>
                      {row.description}
                    </Text>
                  )}
                </Flexbox>
                <Text ellipsis fontSize={12} type={'secondary'}>
                  {parts.length > 0 ? parts.join(' · ') : t('lobeBench.environments.setup.none')}
                </Text>
                <Text
                  className={stylex.props(styles.mono).className}
                  style={{ textAlign: 'right' }}
                >
                  {row.testCaseCount ?? 0}
                </Text>
              </div>
            );
          })}
        </Flexbox>
      </Block>

      <Drawer
        open={!!editing}
        width={640}
        title={
          isNew ? t('lobeBench.environments.editor.new') : t('lobeBench.environments.editor.edit')
        }
        onClose={() => setEditing(undefined)}
      >
        {editing && (
          <Flexbox gap={20}>
            {readOnly && (
              <Text fontSize={12} type={'secondary'}>
                {t('lobeBench.environments.editor.builtIn')}
              </Text>
            )}
            {!isNew && usedBy > 0 && (
              <Tag color={'warning'}>
                {t('lobeBench.environments.editor.impact', { count: usedBy })}
              </Tag>
            )}
            <Flexbox gap={6}>
              <Text weight={500}>{t('lobeBench.environments.editor.name')}</Text>
              <Input
                disabled={readOnly}
                value={name}
                variant={'filled'}
                onChange={(e) => setName(e.target.value)}
              />
            </Flexbox>
            <Flexbox gap={6}>
              <Text weight={500}>{t('lobeBench.environments.editor.description')}</Text>
              <Input
                disabled={readOnly}
                value={description}
                variant={'filled'}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Flexbox>
            <Flexbox gap={6}>
              <Text weight={500}>{t('lobeBench.case.editor.persona')}</Text>
              <TextArea
                autoSize={{ maxRows: 10, minRows: 3 }}
                disabled={readOnly}
                value={persona}
                variant={'filled'}
                onChange={(e) => setPersona(e.target.value)}
              />
            </Flexbox>
            <Flexbox gap={6}>
              <Text weight={500}>{t('lobeBench.environments.editor.agentName')}</Text>
              <Input
                disabled={readOnly}
                value={agentName}
                variant={'filled'}
                onChange={(e) => setAgentName(e.target.value)}
              />
            </Flexbox>
            <Flexbox gap={6}>
              <Text weight={500}>{t('lobeBench.case.editor.plugins')}</Text>
              <Input
                disabled={readOnly}
                placeholder={'lobe-web-browsing, gmail'}
                value={plugins}
                variant={'filled'}
                onChange={(e) => setPlugins(e.target.value)}
              />
            </Flexbox>
            <Flexbox gap={6}>
              <Text weight={500}>{t('lobeBench.case.editor.mock')}</Text>
              <Input
                disabled={readOnly}
                placeholder={'gmail, linear'}
                value={mockServices}
                variant={'filled'}
                onChange={(e) => setMockServices(e.target.value)}
              />
            </Flexbox>
            <Flexbox gap={10}>
              <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
                <Flexbox gap={2}>
                  <Text weight={500}>{t('lobeBench.environments.editor.memory')}</Text>
                  <Text fontSize={12} type={'secondary'}>
                    {t('lobeBench.environments.editor.memory.hint')}
                  </Text>
                </Flexbox>
                <Switch
                  checked={memoryEnabled}
                  disabled={readOnly}
                  onChange={(value) => setMemoryEnabled(!!value)}
                />
              </Flexbox>
              {memoryEnabled && (
                <Flexbox horizontal gap={12} wrap={'wrap'}>
                  <Flexbox gap={6}>
                    <Text fontSize={13}>
                      {t('lobeBench.environments.editor.memory.permission')}
                    </Text>
                    <Segmented
                      disabled={readOnly}
                      size={'small'}
                      value={memoryPermission}
                      options={[
                        { label: 'read-only', value: 'read-only' },
                        { label: 'read-write', value: 'read-write' },
                      ]}
                      onChange={(value) => setMemoryPermission(value as Permission)}
                    />
                  </Flexbox>
                  <Flexbox gap={6}>
                    <Text fontSize={13}>{t('lobeBench.environments.editor.memory.effort')}</Text>
                    <Select
                      disabled={readOnly}
                      size={'small'}
                      style={{ width: 140 }}
                      value={memoryEffort}
                      options={[
                        { label: 'low', value: 'low' },
                        { label: 'medium', value: 'medium' },
                        { label: 'high', value: 'high' },
                      ]}
                      onChange={(value) => setMemoryEffort(value as Effort)}
                    />
                  </Flexbox>
                </Flexbox>
              )}
              <Flexbox gap={6}>
                <Flexbox horizontal align={'center'} justify={'space-between'}>
                  <Text fontSize={13}>{t('lobeBench.environments.editor.memory.seeds')}</Text>
                  {!memoryJson.trim() && (
                    <Button
                      size={'small'}
                      type={'text'}
                      onClick={() => setMemoryJson(JSON.stringify(MEMORY_TEMPLATE, null, 2))}
                    >
                      {t('lobeBench.environments.editor.memory.template')}
                    </Button>
                  )}
                </Flexbox>
                <TextArea
                  autoSize={{ maxRows: 18, minRows: 4 }}
                  disabled={readOnly}
                  placeholder={t('lobeBench.environments.editor.memory.placeholder')}
                  style={{ fontFamily: cssVar.fontFamilyCode, fontSize: 12 }}
                  value={memoryJson}
                  variant={'filled'}
                  onChange={(e) => setMemoryJson(e.target.value)}
                />
              </Flexbox>
            </Flexbox>
            <Flexbox gap={6}>
              <Text weight={500}>{t('lobeBench.case.editor.sessionDate')}</Text>
              <Input
                disabled={readOnly}
                placeholder={'2026-07-20T09:00:00Z'}
                value={sessionDate}
                variant={'filled'}
                onChange={(e) => setSessionDate(e.target.value)}
              />
            </Flexbox>
            <Flexbox gap={6}>
              <Text weight={500}>{t('lobeBench.case.editor.timezone')}</Text>
              <Input
                disabled={readOnly}
                placeholder={'America/New_York'}
                value={timezone}
                variant={'filled'}
                onChange={(e) => setTimezone(e.target.value)}
              />
            </Flexbox>
            <Flexbox gap={6}>
              <Text weight={500}>{t('lobeBench.environments.editor.envPrompt')}</Text>
              <TextArea
                autoSize={{ maxRows: 6, minRows: 2 }}
                disabled={readOnly}
                value={envPrompt}
                variant={'filled'}
                onChange={(e) => setEnvPrompt(e.target.value)}
              />
            </Flexbox>
            <Flexbox horizontal gap={8} justify={'space-between'} wrap={'wrap'}>
              <Flexbox horizontal gap={8}>
                {!isNew && (
                  <>
                    <Button onClick={duplicate}>
                      {t('lobeBench.environments.editor.duplicate')}
                    </Button>
                    {!readOnly && (
                      <Button danger onClick={remove}>
                        {t('lobeBench.case.delete')}
                      </Button>
                    )}
                  </>
                )}
              </Flexbox>
              <Flexbox horizontal gap={8}>
                <Button onClick={() => setEditing(undefined)}>{t('lobeBench.new.cancel')}</Button>
                {!readOnly && (
                  <Button disabled={!name.trim()} loading={saving} type={'primary'} onClick={save}>
                    {t('lobeBench.case.editor.save')}
                  </Button>
                )}
              </Flexbox>
            </Flexbox>
          </Flexbox>
        )}
      </Drawer>
    </Flexbox>
  );
});

LobeBenchEnvironments.displayName = 'LobeBenchEnvironments';

export default LobeBenchEnvironments;
