'use client';

import { Block, Empty, Flexbox, Icon, SortableList } from '@lobehub/ui';
import { Button, Segmented, Text, toast } from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import { FileSearchIcon, FlaskConicalIcon, PencilIcon, PlusIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import Loading from '@/components/Loading/BrandTextLoading';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { expertiseService, type RuleItem, type UpdateRuleInput } from '@/services/expertise';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/slices/preference/selectors/labPrefer';

import { createComposeRuleModal } from './ComposeModal';
import DetailPanel from './DetailPanel';
import { createDistillModal } from './DistillModal';
import { createGroupModal } from './GroupModal';
import GroupSection from './GroupSection';
import { useRules } from './hooks';
import { findMove, mergedIntoId, sectionsByOwner } from './labels';
import OwnerLabel from './OwnerLabel';
import { buildRuleMenu } from './ruleMenu';
import RuleRow from './RuleRow';
import RulesOnboarding, { type RulesOnboardingAgents } from './RulesOnboarding';
import { styles } from './styles';

const LabOff = () => {
  const { t } = useTranslation('memory');
  const navigate = useWorkspaceAwareNavigate();
  return (
    <Flexbox align={'center'} flex={1} justify={'center'}>
      <Empty
        description={t('rules.labOff.description')}
        icon={FlaskConicalIcon}
        title={t('rules.labOff.title')}
      >
        <Button size={'small'} onClick={() => navigate('/settings/labs')}>
          {t('rules.labOff.open')}
        </Button>
      </Empty>
    </Flexbox>
  );
};

/**
 * Self-evolving, as one sheet per part: a switcher above it picks the reviewer's own rules (the
 * default) or what one agent learned by itself. Within the part, groups are full-width section
 * rows and lessons draggable lines under them; the archive sits at the foot and the selected one
 * opens as a document on the right.
 *
 * Both parts are the same thing underneath — lessons in expertise domains, injected into runs —
 * so they share every control. What differs is reach: a rule of the reviewer's reaches every run,
 * an agent's lesson only that agent's, so a lesson can only be moved or merged within its part.
 *
 * Every write goes through the service and then re-reads the list; only the drag reorder and the
 * effect switch are applied optimistically, because both would visibly snap back otherwise.
 */
const MemoryRules = () => {
  const { t } = useTranslation('memory');
  const enabled = useUserStore(labPreferSelectors.enableSelfLearning);
  const { data, error, isLoading, mutate } = useRules();
  const [selectedId, setSelectedId] = useState<string>();
  const [titleEditing, setTitleEditing] = useState(false);
  const [mergeFrom, setMergeFrom] = useState<string>();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [partKey, setPartKey] = useState('mine');

  const groups = useMemo(() => data?.groups ?? [], [data]);
  const sections = useMemo(() => sectionsByOwner(groups), [groups]);
  // The part on screen: the switcher above the sheet picks one, "My rules" by default.
  const part = sections.find((section) => section.key === partKey) ?? sections[0];
  // Which part each group belongs to, so moves and merges never cross from one reach to another.
  const sectionOf = useMemo(
    () =>
      new Map(
        sections.flatMap((section) => section.groups.map((g) => [g.domain.id, section] as const)),
      ),
    [sections],
  );
  const sameSection = (domainId: string) => sectionOf.get(domainId)?.groups ?? [];
  const all = useMemo(() => groups.flatMap((group) => group.rules), [groups]);
  const live = useMemo(() => all.filter((rule) => rule.status === 'active'), [all]);
  const selected = all.find((rule) => rule.id === selectedId);
  const partRules = useMemo(() => part.groups.flatMap((group) => group.rules), [part]);
  const partLive = useMemo(() => partRules.filter((rule) => rule.status === 'active'), [partRules]);
  const partArchived = useMemo(
    () => partRules.filter((rule) => rule.status === 'retired'),
    [partRules],
  );
  const isEmpty = !isLoading && !error && all.length === 0;

  // Display numbers follow the sheet order of the part on screen, not the per-group `P-nn` codes,
  // which restart in every group and would repeat down the page.
  const codes = useMemo(() => {
    const map = new Map<string, string>();
    let n = 0;
    for (const rule of [...partLive, ...partArchived])
      map.set(rule.id, `R${String(++n).padStart(2, '0')}`);
    return map;
  }, [partLive, partArchived]);

  const ruleCount = live.filter((rule) => sectionOf.get(rule.domainId)?.key === 'mine').length;
  const lessonCount = live.length - ruleCount;
  // "My rules" with nothing in it is the reviewer's first screen there, not an empty table.
  const mineOnboarding = !isLoading && !error && part.key === 'mine' && part.groups.length === 0;
  const agentSections = sections.filter((section) => section.owner.kind === 'agent');
  const onboardingAgents: RulesOnboardingAgents | undefined =
    agentSections.length > 0 && agentSections[0].owner.kind === 'agent'
      ? {
          agentCount: agentSections.length,
          lessonCount,
          name: agentSections[0].owner.agent.title || t('rules.owner.untitledAgent'),
          onOpen: () => switchPart(agentSections[0].key),
        }
      : undefined;

  // A selection or a merge in progress belongs to the part it started in; switching drops both,
  // so a merge can only ever pick a target within its own part.
  const switchPart = (key: string) => {
    setPartKey(key);
    setSelectedId(undefined);
    setTitleEditing(false);
    setMergeFrom(undefined);
  };

  const refresh = () => mutate();

  const patchLocal = (id: string, patch: Partial<RuleItem>) =>
    mutate(
      (current) =>
        current && {
          ...current,
          groups: current.groups.map((group) => ({
            ...group,
            rules: group.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
          })),
        },
      { revalidate: false },
    );

  // Optimistic writes must not outlive a failed request: re-read the server's truth and say so.
  const recover = async (error: unknown) => {
    console.error('[MemoryRules] write failed:', error);
    toast.error(t('rules.saveFailed'));
    await refresh();
  };

  /** Resolves to whether the change was saved, so callers keep unsaved input on failure. */
  const updateRule = async (id: string, patch: UpdateRuleInput) => {
    try {
      if (patch.enforcement) await patchLocal(id, { enforcement: patch.enforcement });
      await expertiseService.updateRule(id, patch);
      await refresh();
      return true;
    } catch (error) {
      await recover(error);
      return false;
    }
  };

  const reorder = async (domainId: string, items: RuleItem[]) => {
    const previous = (groups.find((group) => group.domain.id === domainId)?.rules ?? [])
      .filter((rule) => rule.status === 'active')
      .map((rule) => rule.id);
    const move = findMove(
      previous,
      items.map((rule) => rule.id),
    );
    if (!move) return;
    await mutate(
      (current) =>
        current && {
          ...current,
          groups: current.groups.map((group) =>
            group.domain.id === domainId
              ? { ...group, rules: [...items, ...group.rules.filter((r) => r.status !== 'active')] }
              : group,
          ),
        },
      { revalidate: false },
    );
    try {
      await expertiseService.reorderRule(domainId, move.id, move.beforeId);
      await refresh();
    } catch (error) {
      await recover(error);
    }
  };

  /** Every list mutation: re-read after it, and on failure say so and show what is saved. */
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await refresh();
    } catch (error) {
      await recover(error);
    }
  };

  const handlers = {
    archive: (id: string) => void run(() => expertiseService.archiveRule(id)),
    // Rewording opens the document with the title already in edit mode.
    edit: (id: string) => {
      setSelectedId(id);
      setTitleEditing(true);
    },
    merge: (id: string) => setMergeFrom(id),
    move: (id: string, domainId: string) =>
      void run(async () => {
        const moved = await expertiseService.moveRule(id, domainId);
        if (moved && selectedId === id) setSelectedId(moved.id);
      }),
    restore: (id: string) => void run(() => expertiseService.restoreRule(id)),
  };

  const select = (id: string) => {
    setTitleEditing(false);
    if (mergeFrom && mergeFrom !== id) {
      // Only a rule still in force can absorb another; archived rows are not targets, and a
      // lesson cannot be folded into one with a different reach.
      const into = all.find((rule) => rule.id === id);
      const from = all.find((rule) => rule.id === mergeFrom);
      if (into?.status !== 'active') return;
      if (!from || sectionOf.get(into.domainId) !== sectionOf.get(from.domainId)) return;
      const target = id;
      const source = mergeFrom;
      // Leave merge mode whatever the outcome, so a failure does not strand the page in it.
      setMergeFrom(undefined);
      void run(async () => {
        await expertiseService.mergeRules(source, target);
        setSelectedId(target);
      });
      return;
    }
    setSelectedId(selectedId === id ? undefined : id);
  };

  // Distilling files into the part on screen, like writing: its groups, and a new group only in
  // the reviewer's own part (a new group always mounts on the reviewer).
  const distill = () =>
    createDistillModal({
      canOpenGroup: part.key === 'mine',
      groups: part.groups,
      onDone: (ids) => {
        if (ids[0]) setSelectedId(ids[0]);
        void refresh();
      },
    });

  // Writing files into the part on screen: the header offers its groups, a group's `+` that group.
  const compose = (defaultGroupId?: string) =>
    createComposeRuleModal({
      canOpenGroup: part.key === 'mine',
      defaultGroupId,
      groups: part.groups,
      onCreated: (id) => {
        setSelectedId(id);
        void refresh();
      },
    });

  const openGroupModal = (group?: (typeof groups)[number]) =>
    createGroupModal({ group, onDone: () => void refresh() });

  const renderRow = (rule: RuleItem) => (
    <RuleRow
      active={rule.id === selectedId}
      code={codes.get(rule.id) ?? ''}
      menu={buildRuleMenu(t, rule, sameSection(rule.domainId), handlers)}
      rule={rule}
      taughtToAgent={part.owner.kind === 'agent'}
      archivedInto={(() => {
        const into = mergedIntoId(rule);
        return into ? (all.find((r) => r.id === into)?.title ?? into) : null;
      })()}
      onEnforcement={(enforcement) => void updateRule(rule.id, { enforcement })}
      onSelect={() => select(rule.id)}
    />
  );

  const renderGroup = (group: (typeof groups)[number]) => {
    const items = group.rules.filter((rule) => rule.status === 'active');
    const isCollapsed = Boolean(collapsed[group.domain.id]);
    return (
      <div key={group.domain.id}>
        <GroupSection
          collapsed={isCollapsed}
          count={items.length}
          group={group}
          menu={[
            {
              disabled: true,
              key: 'gate',
              label: (
                <span className={styles.muted} style={{ display: 'block', maxWidth: 280 }}>
                  {t('rules.group.gate', { gate: group.domain.domainFilter })}
                </span>
              ),
            },
            { type: 'divider' },
            {
              icon: <Icon icon={PencilIcon} />,
              key: 'rename',
              label: t('rules.actions.renameGroup'),
              onClick: () => openGroupModal(group),
            },
          ]}
          onToggle={() => setCollapsed((c) => ({ ...c, [group.domain.id]: !c[group.domain.id] }))}
          onWrite={() => compose(group.domain.id)}
        />
        {isCollapsed ? null : items.length === 0 ? (
          <div className={styles.muted} style={{ padding: '10px 8px' }}>
            {t('rules.group.empty')}
          </div>
        ) : (
          <SortableList
            gap={0}
            items={items}
            renderItem={renderRow}
            onChange={(next) => void reorder(group.domain.id, next)}
          />
        )}
      </div>
    );
  };

  if (!enabled) {
    return (
      <Flexbox height={'100%'} width={'100%'}>
        <NavHeader />
        <LabOff />
      </Flexbox>
    );
  }

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <NavHeader />
      <Flexbox horizontal flex={1} height={'100%'} width={'100%'}>
        <Flexbox className={styles.body}>
          <WideScreenContainer gap={18} paddingBlock={'24px 96px'}>
            <Flexbox
              horizontal
              align={'flex-start'}
              gap={16}
              justify={'space-between'}
              paddingInline={8}
            >
              <Flexbox gap={4}>
                <Text fontSize={26} weight={700}>
                  {t('rules.title')}
                </Text>
                {/* A count of zero says nothing; with no rules yet, only what agents learned. */}
                {!isEmpty && (
                  <Text type={'secondary'}>
                    {ruleCount > 0
                      ? t('rules.subtitle', { lessons: lessonCount, rules: ruleCount })
                      : t('rules.subtitleAgentsOnly', { lessons: lessonCount })}
                  </Text>
                )}
              </Flexbox>
              {/* One primary action. Writing a rule also opens the group when the reviewer has
                  none, so a separate "new group" button would be a second way to start. */}
              {!mineOnboarding && (
                <Flexbox horizontal gap={8}>
                  <Button icon={<Icon icon={FileSearchIcon} />} onClick={distill}>
                    {t('rules.actions.distill')}
                  </Button>
                  <Button
                    icon={<Icon icon={PlusIcon} />}
                    type={'primary'}
                    onClick={() => compose()}
                  >
                    {t('rules.actions.write')}
                  </Button>
                </Flexbox>
              )}
            </Flexbox>

            {mergeFrom && (
              <Block gap={4} padding={12} variant={'filled'}>
                <Text fontSize={13}>
                  {t('rules.merge.banner', {
                    title: all.find((rule) => rule.id === mergeFrom)?.title ?? '',
                  })}
                </Text>
                <Flexbox horizontal>
                  <Button size={'small'} onClick={() => setMergeFrom(undefined)}>
                    {t('rules.merge.cancel')}
                  </Button>
                </Flexbox>
              </Block>
            )}

            <AsyncBoundary
              data={data}
              error={error}
              errorVariant={'page'}
              isEmpty={isEmpty}
              isLoading={isLoading}
              loading={<Loading debugId={'MemoryRules'} />}
              empty={
                <RulesOnboarding
                  backlogRounds={data?.backlogRounds}
                  onDistill={distill}
                  onWrite={() => compose()}
                />
              }
              onRetry={() => void refresh()}
            >
              <div>
                {/* Whose sheet this is: the reviewer's own rules, or one agent's lessons. Only
                    shown once some agent has learned something, so there is a choice to make. */}
                {sections.length > 1 && (
                  <Flexbox horizontal paddingBlock={'0 12px'} paddingInline={8}>
                    <Segmented
                      value={part.key}
                      options={sections.map((section) => ({
                        label: (
                          <OwnerLabel
                            owner={section.owner}
                            count={
                              section.groups
                                .flatMap((group) => group.rules)
                                .filter((rule) => rule.status === 'active').length
                            }
                          />
                        ),
                        value: section.key,
                      }))}
                      onChange={(value) => switchPart(String(value))}
                    />
                  </Flexbox>
                )}
                {!mineOnboarding && (
                  <div className={cx(styles.grid, styles.thead)}>
                    <span />
                    <span>{t('rules.columns.code')}</span>
                    <span>{t('rules.columns.rule')}</span>
                    <span>{t('rules.columns.enforcement')}</span>
                    <span>{t('rules.columns.method')}</span>
                    <span>{t('rules.columns.runs')}</span>
                    <span />
                  </div>
                )}
                {/* The reviewer's part shows even before it holds anything: it is where they
                    learn that their rejections become rules. */}
                {mineOnboarding ? (
                  <RulesOnboarding
                    inline
                    agents={onboardingAgents}
                    backlogRounds={data?.backlogRounds}
                    onDistill={distill}
                    onWrite={() => compose()}
                  />
                ) : (
                  part.groups.map(renderGroup)
                )}
                {partArchived.length > 0 && (
                  <>
                    <div className={styles.divider}>
                      {t('rules.archived.group', { count: partArchived.length })}
                    </div>
                    <SortableList
                      gap={0}
                      items={partArchived}
                      renderItem={renderRow}
                      onChange={() => {}}
                    />
                  </>
                )}
              </div>
            </AsyncBoundary>
          </WideScreenContainer>
        </Flexbox>
        {all.length > 0 && (
          <DetailPanel
            code={selected ? codes.get(selected.id) : undefined}
            group={groups.find((group) => group.domain.id === selected?.domainId)}
            groups={groups}
            rule={selected}
            titleEditing={titleEditing}
            menu={
              selected ? buildRuleMenu(t, selected, sameSection(selected.domainId), handlers) : []
            }
            onTitleEditing={setTitleEditing}
            onClose={() => {
              setSelectedId(undefined);
              setTitleEditing(false);
            }}
            onUpdate={(patch) =>
              selected ? updateRule(selected.id, patch) : Promise.resolve(false)
            }
          />
        )}
      </Flexbox>
    </Flexbox>
  );
};

export default MemoryRules;
