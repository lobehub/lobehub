'use client';

import type { EvalCaseEnvironment } from '@lobechat/types';
import {
  Block,
  Button,
  Checkbox,
  confirmModal,
  Drawer,
  Empty,
  Flexbox,
  Input,
  Select,
  Tag,
  Text,
  toast,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { TFunction } from 'i18next';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import CaseEditor, { type CaseDraft } from '@/features/LobeBench/CaseEditor';
import { openContenderModal } from '@/features/LobeBench/ContenderForm';
import { openConversationPicker } from '@/features/LobeBench/ConversationPicker';
import {
  CASE_LEVELS,
  getCaseCategory,
  getCaseConnectors,
  getCaseDifficulty,
  getCaseLevel,
  getCaseRules,
  getCaseTitle,
  isBuiltInRow,
  levelLabelKey,
  levelTagColor,
  LOBE_BENCH_PATH,
  nativeCaseId,
} from '@/features/LobeBench/lobeBench';
import { openCreateDatasetModal } from '@/features/LobeBench/PicksDatasetModal';
import { startSingleCaseRun } from '@/features/LobeBench/singleCaseRun';
import {
  type LobeBenchCase,
  useDatasetCases,
  useLobeBenchBenchmarks,
} from '@/features/LobeBench/useLobeBench';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { agentEvalService } from '@/services/agentEval';

/** The preset Memory records an attempt starts with, flattened across layers. */
const presetMemoryRecords = (environment?: EvalCaseEnvironment) =>
  Object.entries(environment?.memory ?? {}).flatMap(([layer, value]) =>
    Array.isArray(value)
      ? (value as Record<string, unknown>[]).map((record) => ({
          layer: layer.replace(/s$/, ''),
          title: String(record.title ?? record.summary ?? ''),
        }))
      : [],
  );

/** "Memory read-write · effort medium · starts with 6 preset records", in the user's words. */
const describeCaseMemory = (environment: EvalCaseEnvironment | undefined, t: TFunction<'eval'>) => {
  const mode = environment?.agent?.memory;
  if (mode?.enabled === false) return t('lobeBench.case.runsWith.memoryOff');
  const records = presetMemoryRecords(environment).length;
  const start = records
    ? t('lobeBench.case.runsWith.memoryRecords', { count: records })
    : t('lobeBench.case.runsWith.memoryEmpty');
  return `${t('lobeBench.case.runsWith.memoryMode', {
    effort: mode?.effort ?? 'medium',
    permission: mode?.toolPermission ?? 'read-write',
  })} · ${start}`;
};

const styles = stylex.create({
  table: {
    display: 'grid',
    gridTemplateColumns: '36px minmax(0, 1fr) 150px 110px 240px',
    columnGap: 12,
    alignItems: 'center',
  },
  // The same columns behind a checkbox, where cases can be picked.
  tableSelectable: {
    gridTemplateColumns: '20px 36px minmax(0, 1fr) 150px 110px 240px',
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
  pre: {
    overflow: 'auto',
    maxHeight: 240,
    margin: 0,
    padding: 12,
    borderRadius: cssVar.borderRadius,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 12,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    backgroundColor: cssVar.colorFillQuaternary,
  },
});

interface CaseTableProps {
  /** The Lobe Bench benchmarks a new dataset can be filed under. */
  benchmarkIds: string[];
  /** The case set shown; its metadata says whether its cases can be edited. */
  dataset?: {
    benchmarkId?: string | null;
    evalConfig?: unknown;
    evalMode?: string | null;
    id: string;
    metadata?: Record<string, unknown> | null;
    name?: string;
  };
  /**
   * The account writes cases here: new ones, ones drafted from a conversation,
   * edits and deletes. No page passes it yet: a dataset's cases are fixed once
   * it is made, and the account's own cases are planned as a private part of
   * the library that checked cases are copied from like built-in ones.
   */
  editable?: boolean;
  /** Built-in datasets of library cases (Hard 50) each case belongs to, by its native id. */
  memberships?: Record<string, string[]>;
  /** The library: checked cases make a new dataset of the account's. */
  selectable?: boolean;
}

type EditorState = { draft?: CaseDraft; testCase?: LobeBenchCase } | undefined;

/**
 * The cases of one dataset and a drawer with everything a case carries. In
 * the library, checked cases make a new dataset of the account's, holding
 * copies of them; a dataset's cases are fixed once it is made, so its past
 * runs stay true to it.
 */
const CaseTable = memo<CaseTableProps>(
  ({ benchmarkIds, dataset, editable, memberships, selectable }) => {
    const { t } = useTranslation('eval');
    const navigate = useWorkspaceAwareNavigate();
    const datasetId = dataset?.id;
    const benchmarkId = dataset?.benchmarkId ?? benchmarkIds[0];
    const { benchmarks } = useLobeBenchBenchmarks();
    const benchmark = benchmarks.find((b) => b.id === benchmarkId);
    const { data: cases, isLoading, mutate: refreshCases } = useDatasetCases(datasetId);
    const picking = !!selectable;
    const [checked, setChecked] = useState<Set<string>>(() => new Set());
    const [open, setOpen] = useState<LobeBenchCase>();
    const [editor, setEditor] = useState<EditorState>();
    const [busy, setBusy] = useState(false);
    const [query, setQuery] = useState('');
    const [categoryFilter, setCategoryFilter] = useState<string>();
    const [levelFilter, setLevelFilter] = useState<string>();
    const openLevel = open ? getCaseLevel(open) : undefined;

    const categories = useMemo(
      () => [...new Set((cases ?? []).map((item) => getCaseCategory(item)))].sort(),
      [cases],
    );
    const levels = useMemo(() => {
      const present = new Set((cases ?? []).map((item) => getCaseLevel(item)));
      return CASE_LEVELS.filter((level) => present.has(level));
    }, [cases]);
    const levelCounts = useMemo(
      () =>
        Object.fromEntries(
          CASE_LEVELS.map((level) => [
            level,
            (cases ?? []).filter((item) => getCaseLevel(item) === level).length,
          ]),
        ) as Record<(typeof CASE_LEVELS)[number], number>,
      [cases],
    );
    const visibleCases = useMemo(() => {
      const needle = query.trim().toLowerCase();
      return (cases ?? [])
        .map((item, position) => ({ item, position }))
        .filter(({ item }) => {
          if (categoryFilter && getCaseCategory(item) !== categoryFilter) return false;
          if (levelFilter && getCaseLevel(item) !== levelFilter) return false;
          if (!needle) return true;
          return [getCaseTitle(item), item.content?.input ?? '', ...getCaseConnectors(item)]
            .join(' ')
            .toLowerCase()
            .includes(needle);
        });
    }, [cases, categoryFilter, levelFilter, query]);

    const fail = (error: unknown) =>
      toast.error(error instanceof Error ? error.message : String(error));

    // From a conversation: the server drafts request, context, setup and rules;
    // the author edits before anything is saved.
    const draftFromConversation = () =>
      openConversationPicker(async (topicId) => {
        setBusy(true);
        const pending = toast.loading(t('lobeBench.case.fromConversation.drafting'));
        try {
          const draft = await agentEvalService.draftTestCaseFromTopic({
            benchmarkId,
            draftRules: true,
            topicId,
          });
          if (draft.rulesError)
            toast.warning(
              t('lobeBench.case.fromConversation.rulesFailed', { error: draft.rulesError }),
            );
          setEditor({
            draft: {
              environment: draft.agent
                ? {
                    agent: {
                      ...(draft.agent.systemRole && { systemRole: draft.agent.systemRole }),
                      plugins: draft.agent.plugins,
                    },
                  }
                : undefined,
              input: draft.input,
              messages: draft.messages,
              rules: draft.rules,
              sessionDate: draft.sessionDate,
              sourceTopicId: topicId,
              title: draft.title,
            },
          });
        } catch (error) {
          fail(error);
        } finally {
          pending.close();
          setBusy(false);
        }
      });

    const remove = (testCase: LobeBenchCase) =>
      confirmModal({
        content: t('lobeBench.case.delete.confirm'),
        okButtonProps: { danger: true },
        okText: t('lobeBench.case.delete'),
        onOk: async () => {
          try {
            const result = (await agentEvalService.deleteTestCase(testCase.id)) as {
              error?: string;
              success?: boolean;
            };
            if (result?.success === false) throw new Error(result.error ?? 'Delete failed');
            setOpen(undefined);
            await refreshCases();
          } catch (error) {
            fail(error);
          }
        },
        title: t('lobeBench.case.delete'),
      });

    const rowsOf = (caseIds: string[]) =>
      (cases ?? []).filter((item) => caseIds.includes(nativeCaseId(item)));

    // Library cases are read-only; checked ones make a new dataset of the account's.
    const createDataset = (caseIds: string[]) => {
      if (!benchmarkId || caseIds.length === 0) return;
      openCreateDatasetModal({
        benchmarkId,
        cases: rowsOf(caseIds),
        library: dataset,
        onDone: (created) => {
          setChecked(new Set());
          setOpen(undefined);
          navigate(`${LOBE_BENCH_PATH}/datasets/${created.id}`);
        },
      });
    };

    const visibleIds = visibleCases.map(({ item }) => nativeCaseId(item));
    const allVisibleChecked = visibleIds.length > 0 && visibleIds.every((id) => checked.has(id));
    const toggle = (id: string, on: boolean) =>
      setChecked((previous) => {
        const next = new Set(previous);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      });
    const toggleVisible = (on: boolean) =>
      setChecked((previous) => {
        const next = new Set(previous);
        for (const id of visibleIds) {
          if (on) next.add(id);
          else next.delete(id);
        }
        return next;
      });

    // One case, one contender, one attempt — then straight to the trajectory.
    const testRun = (testCase: LobeBenchCase) =>
      openContenderModal(
        async (contender) => {
          if (!datasetId || !benchmarkId) return;
          setBusy(true);
          try {
            const runId = await startSingleCaseRun({ benchmark, contender, datasetId, testCase });
            navigate(`/eval/bench/${benchmarkId}/runs/${runId}/cases/${testCase.id}`);
          } catch (error) {
            fail(error);
          } finally {
            setBusy(false);
          }
        },
        t('lobeBench.case.testRun'),
        t('lobeBench.case.testRun.go'),
      );

    return (
      <>
        <Block padding={8} variant={'outlined'}>
          <Flexbox gap={2}>
            <Flexbox
              horizontal
              align={'center'}
              gap={8}
              justify={'space-between'}
              padding={'4px 12px'}
            >
              <Text fontSize={12} type={'secondary'}>
                {t('lobeBench.library.cases', { count: cases?.length ?? 0 })}
                {levels.length > 0 &&
                  ` · ${t('lobeBench.library.levels', {
                    l1: levelCounts.L1,
                    l2: levelCounts.L2,
                    l3: levelCounts.L3,
                    l4: levelCounts.L4,
                  })}`}
              </Text>
              <Flexbox horizontal align={'center'} gap={8}>
                {checked.size > 0 ? (
                  <>
                    <Text fontSize={12} type={'secondary'}>
                      {t('lobeBench.picks.selected', { count: checked.size })}
                    </Text>
                    <Button size={'small'} type={'text'} onClick={() => setChecked(new Set())}>
                      {t('lobeBench.picks.clear')}
                    </Button>
                    <Button
                      size={'small'}
                      type={'primary'}
                      onClick={() => createDataset([...checked])}
                    >
                      {t('lobeBench.picks.create')}
                    </Button>
                  </>
                ) : (
                  <Text fontSize={12} type={'secondary'}>
                    {picking && t('lobeBench.picks.hint.library')}
                  </Text>
                )}
                {editable && (
                  <>
                    <Button loading={busy} size={'small'} onClick={draftFromConversation}>
                      {t('lobeBench.case.fromConversation')}
                    </Button>
                    <Button size={'small'} type={'primary'} onClick={() => setEditor({})}>
                      {t('lobeBench.case.new')}
                    </Button>
                  </>
                )}
              </Flexbox>
            </Flexbox>
            {(cases?.length ?? 0) > 5 && (
              <Flexbox horizontal align={'center'} gap={8} padding={'4px 12px'} wrap={'wrap'}>
                <Input
                  allowClear
                  placeholder={t('lobeBench.library.filter.search')}
                  size={'small'}
                  style={{ maxWidth: 280 }}
                  value={query}
                  variant={'filled'}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {categories.length > 1 && (
                  <Select
                    allowClear
                    options={categories.map((category) => ({ label: category, value: category }))}
                    placeholder={t('lobeBench.library.filter.category')}
                    size={'small'}
                    style={{ width: 200 }}
                    value={categoryFilter}
                    variant={'filled'}
                    onChange={(value) => setCategoryFilter((value as string) || undefined)}
                  />
                )}
                {levels.length > 1 && (
                  <Select
                    allowClear
                    placeholder={t('lobeBench.library.filter.level')}
                    size={'small'}
                    style={{ width: 150 }}
                    value={levelFilter}
                    variant={'filled'}
                    options={levels.map((level) => ({
                      label: t(levelLabelKey(level)),
                      value: level,
                    }))}
                    onChange={(value) => setLevelFilter((value as string) || undefined)}
                  />
                )}
                {(query || categoryFilter || levelFilter) && (
                  <Text fontSize={12} type={'secondary'}>
                    {t('lobeBench.library.filter.count', {
                      shown: visibleCases.length,
                      total: cases?.length ?? 0,
                    })}
                  </Text>
                )}
              </Flexbox>
            )}
            <div
              className={
                stylex.props(styles.table, picking && styles.tableSelectable, styles.head).className
              }
            >
              {picking && (
                <Checkbox
                  checked={allVisibleChecked}
                  disabled={visibleIds.length === 0}
                  indeterminate={!allVisibleChecked && visibleIds.some((id) => checked.has(id))}
                  onChange={toggleVisible}
                />
              )}
              <span>#</span>
              <span>{t('lobeBench.library.col.case')}</span>
              <span>{t('lobeBench.library.col.category')}</span>
              <span>{t('lobeBench.library.col.level')}</span>
              <span>{t('lobeBench.library.col.tools')}</span>
            </div>
            {!isLoading && (cases?.length ?? 0) === 0 && (
              <Empty description={t('lobeBench.library.empty')} />
            )}
            {visibleCases.map(({ item, position }) => {
              const level = getCaseLevel(item);
              const connectors = getCaseConnectors(item);
              // Published sets number their cases; the account's own set counts rows.
              const index =
                typeof item.metadata?.index === 'number' ? item.metadata.index : position + 1;
              return (
                <div
                  key={item.id}
                  className={
                    stylex.props(styles.table, picking && styles.tableSelectable, styles.row)
                      .className
                  }
                  onClick={() => setOpen(item)}
                >
                  {picking && (
                    // Picking a case must not open it.
                    <span onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={checked.has(nativeCaseId(item))}
                        onChange={(on) => toggle(nativeCaseId(item), on)}
                      />
                    </span>
                  )}
                  <span
                    className={stylex.props(styles.mono).className}
                    style={{ color: cssVar.colorTextQuaternary }}
                  >
                    {index}
                  </span>
                  <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
                    <Text ellipsis>{getCaseTitle(item)}</Text>
                    {memberships?.[nativeCaseId(item)]?.map((name) => (
                      <Tag key={name} style={{ flex: 'none' }}>
                        {name}
                      </Tag>
                    ))}
                  </Flexbox>
                  <Text ellipsis fontSize={12} type={'secondary'}>
                    {getCaseCategory(item)}
                  </Text>
                  <span>
                    {level && <Tag color={levelTagColor(level)}>{t(levelLabelKey(level))}</Tag>}
                  </span>
                  <Text ellipsis fontSize={12} type={'secondary'}>
                    {connectors.slice(0, 3).join(' · ')}
                    {connectors.length > 3 && ` +${connectors.length - 3}`}
                  </Text>
                </div>
              );
            })}
          </Flexbox>
        </Block>

        <Drawer
          open={!!open}
          title={open ? getCaseTitle(open) : ''}
          width={560}
          onClose={() => setOpen(undefined)}
        >
          {open && (
            <Flexbox gap={20}>
              <Flexbox horizontal gap={8} wrap={'wrap'}>
                <Tag>{getCaseCategory(open)}</Tag>
                {memberships?.[nativeCaseId(open)]?.map((name) => (
                  <Tag key={name}>{name}</Tag>
                ))}
                {openLevel && (
                  <Tag color={levelTagColor(openLevel)}>{t(levelLabelKey(openLevel))}</Tag>
                )}
                {!editable && (
                  <Tag>
                    {isBuiltInRow(dataset as { userId?: string | null } | undefined)
                      ? t('lobeBench.builtIn')
                      : t('lobeBench.case.readOnly')}
                  </Tag>
                )}
              </Flexbox>
              {getCaseDifficulty(open)?.signals?.length ? (
                <Text fontSize={12} type={'secondary'}>
                  {t('lobeBench.case.difficulty.why', {
                    signals: getCaseDifficulty(open)!.signals!.join(', '),
                  })}
                </Text>
              ) : null}
              <Flexbox horizontal gap={8} wrap={'wrap'}>
                <Button
                  loading={busy}
                  size={'small'}
                  title={t('lobeBench.case.testRun.hint')}
                  type={'primary'}
                  onClick={() => testRun(open)}
                >
                  {t('lobeBench.case.testRun')}
                </Button>
                {editable ? (
                  <>
                    <Button size={'small'} onClick={() => setEditor({ testCase: open })}>
                      {t('lobeBench.case.edit')}
                    </Button>
                    <Button danger size={'small'} onClick={() => remove(open)}>
                      {t('lobeBench.case.delete')}
                    </Button>
                  </>
                ) : (
                  selectable && (
                    <Button size={'small'} onClick={() => createDataset([nativeCaseId(open)])}>
                      {t('lobeBench.picks.create')}
                    </Button>
                  )
                )}
              </Flexbox>
              <Flexbox gap={6}>
                <Text weight={500}>{t('lobeBench.case.prompt')}</Text>
                <pre className={stylex.props(styles.pre).className}>{open.content?.input}</pre>
              </Flexbox>
              {open.content?.environment?.agent?.systemRole && (
                <Flexbox gap={6}>
                  <Text weight={500}>{t('lobeBench.case.persona')}</Text>
                  <pre className={stylex.props(styles.pre).className}>
                    {open.content.environment.agent.systemRole}
                  </pre>
                </Flexbox>
              )}
              {/* What the attempt is given, in the user's words: the simulated
                connectors, the Memory it starts from and the pinned clock. The
                shared environment is already merged into content.environment. */}
              <Flexbox gap={8}>
                <Text weight={500}>{t('lobeBench.case.runsWith')}</Text>
                <Flexbox gap={4}>
                  <Text fontSize={12} type={'secondary'}>
                    {t('lobeBench.case.runsWith.connectors')}
                  </Text>
                  {getCaseConnectors(open).length > 0 ? (
                    <Flexbox horizontal gap={6} wrap={'wrap'}>
                      {getCaseConnectors(open).map((id) => (
                        <Tag key={id}>{id}</Tag>
                      ))}
                    </Flexbox>
                  ) : (
                    <Text fontSize={13}>{t('lobeBench.case.runsWith.noConnectors')}</Text>
                  )}
                </Flexbox>
                <Flexbox gap={4}>
                  <Text fontSize={12} type={'secondary'}>
                    {t('lobeBench.case.runsWith.memory')}
                  </Text>
                  <Text fontSize={13}>{describeCaseMemory(open.content?.environment, t)}</Text>
                  {presetMemoryRecords(open.content?.environment).length > 0 && (
                    <Flexbox horizontal gap={6} wrap={'wrap'}>
                      {presetMemoryRecords(open.content?.environment).map((record, index) => (
                        <Tag key={index}>
                          {record.layer} · {record.title}
                        </Tag>
                      ))}
                    </Flexbox>
                  )}
                </Flexbox>
                <Flexbox gap={4}>
                  <Text fontSize={12} type={'secondary'}>
                    {t('lobeBench.case.runsWith.clock')}
                  </Text>
                  <Text fontSize={13}>
                    {open.content?.environment?.sessionDate
                      ? t('lobeBench.case.runsWith.clockPinned', {
                          date: `${open.content.environment.sessionDate} · ${open.content.environment.timezone ?? 'UTC'}`,
                        })
                      : t('lobeBench.case.runsWith.clockWall')}
                  </Text>
                </Flexbox>
              </Flexbox>
              {getCaseRules(open).length > 0 && (
                <Flexbox gap={6}>
                  <Text weight={500}>{t('lobeBench.case.rules')}</Text>
                  <Flexbox gap={4}>
                    {getCaseRules(open).map((rule, index) => (
                      <Text fontSize={13} key={index}>
                        {rule}
                      </Text>
                    ))}
                  </Flexbox>
                </Flexbox>
              )}
            </Flexbox>
          )}
        </Drawer>

        {datasetId && (
          <CaseEditor
            datasetId={datasetId}
            draft={editor?.draft}
            open={!!editor}
            testCase={editor?.testCase}
            onClose={() => setEditor(undefined)}
            onSaved={async () => {
              setOpen(undefined);
              await refreshCases();
            }}
          />
        )}
      </>
    );
  },
);

CaseTable.displayName = 'LobeBenchCaseTable';

export default CaseTable;
