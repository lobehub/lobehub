'use client';

import { Block, Empty, Flexbox, Icon, SortableList } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import { FlaskConicalIcon, PencilIcon, PlusIcon, ScaleIcon } from 'lucide-react';
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
import { createGroupModal } from './GroupModal';
import GroupSection from './GroupSection';
import { useRules } from './hooks';
import { mergedIntoId } from './labels';
import { buildRuleMenu } from './ruleMenu';
import RuleRow from './RuleRow';
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
 * The reviewer's rules as one sheet: groups as full-width section rows, rules as draggable lines
 * under them, the archive at the foot, and the selected rule opened as a document on the right.
 *
 * Every write goes through the service and then re-reads the list; only the drag reorder and the
 * effect switch are applied optimistically, because both would visibly snap back otherwise.
 */
const MemoryRules = () => {
  const { t } = useTranslation('memory');
  const enabled = useUserStore(labPreferSelectors.enableMemoryRules);
  const { data, error, isLoading, mutate } = useRules();
  const [selectedId, setSelectedId] = useState<string>();
  const [titleEditing, setTitleEditing] = useState(false);
  const [mergeFrom, setMergeFrom] = useState<string>();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => data?.groups ?? [], [data]);
  const all = useMemo(() => groups.flatMap((group) => group.rules), [groups]);
  const live = useMemo(() => all.filter((rule) => rule.status === 'active'), [all]);
  const archived = useMemo(() => all.filter((rule) => rule.status === 'retired'), [all]);
  const selected = all.find((rule) => rule.id === selectedId);
  const isEmpty = !isLoading && !error && all.length === 0;

  // Display numbers follow the sheet order, not the per-group `P-nn` codes, which restart in
  // every group and would repeat down the page.
  const codes = useMemo(() => {
    const map = new Map<string, string>();
    let n = 0;
    for (const rule of [...live, ...archived]) map.set(rule.id, `R${String(++n).padStart(2, '0')}`);
    return map;
  }, [live, archived]);

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

  const updateRule = async (id: string, patch: UpdateRuleInput) => {
    if (patch.enforcement) await patchLocal(id, { enforcement: patch.enforcement });
    await expertiseService.updateRule(id, patch);
    await refresh();
  };

  const reorder = async (domainId: string, items: RuleItem[]) => {
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
    await expertiseService.reorderRules(
      domainId,
      items.map((rule) => rule.id),
    );
    await refresh();
  };

  const run = async (action: () => Promise<unknown>) => {
    await action();
    await refresh();
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
      const target = id;
      void run(async () => {
        await expertiseService.mergeRules(mergeFrom, target);
        setMergeFrom(undefined);
        setSelectedId(target);
      });
      return;
    }
    setSelectedId(selectedId === id ? undefined : id);
  };

  const compose = (defaultGroupId?: string) =>
    createComposeRuleModal({
      defaultGroupId,
      groups,
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
      menu={buildRuleMenu(t, rule, groups, handlers)}
      rule={rule}
      archivedInto={(() => {
        const into = mergedIntoId(rule);
        return into ? (all.find((r) => r.id === into)?.title ?? into) : null;
      })()}
      onEnforcement={(enforcement) => void updateRule(rule.id, { enforcement })}
      onSelect={() => select(rule.id)}
    />
  );

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
                <Text type={'secondary'}>{t('rules.subtitle', { count: live.length })}</Text>
              </Flexbox>
              {/* One primary action. Writing a rule also opens the group when the reviewer has
                  none, so a separate "new group" button would be a second way to start. */}
              <Button icon={<Icon icon={PlusIcon} />} type={'primary'} onClick={() => compose()}>
                {t('rules.actions.write')}
              </Button>
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
                <Empty
                  icon={ScaleIcon}
                  title={t('rules.empty.title')}
                  description={
                    <Flexbox align={'center'} gap={8}>
                      <span>{t('rules.empty.description')}</span>
                      {Boolean(data?.backlogRounds) && (
                        <Text fontSize={13} type={'secondary'}>
                          {t('rules.backlog', { count: data!.backlogRounds })}
                        </Text>
                      )}
                      <Button onClick={() => compose()}>{t('rules.empty.write')}</Button>
                    </Flexbox>
                  }
                />
              }
              onRetry={() => void refresh()}
            >
              <div>
                <div className={cx(styles.grid, styles.thead)}>
                  <span />
                  <span>{t('rules.columns.code')}</span>
                  <span>{t('rules.columns.rule')}</span>
                  <span>{t('rules.columns.enforcement')}</span>
                  <span>{t('rules.columns.method')}</span>
                  <span>{t('rules.columns.runs')}</span>
                  <span />
                </div>
                {groups.map((group) => {
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
                              <span
                                className={styles.muted}
                                style={{ display: 'block', maxWidth: 280 }}
                              >
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
                        onWrite={() => compose(group.domain.id)}
                        onToggle={() =>
                          setCollapsed((c) => ({ ...c, [group.domain.id]: !c[group.domain.id] }))
                        }
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
                })}
                {archived.length > 0 && (
                  <>
                    <div className={styles.divider}>
                      {t('rules.archived.group', { count: archived.length })}
                    </div>
                    <SortableList
                      gap={0}
                      items={archived}
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
            menu={selected ? buildRuleMenu(t, selected, groups, handlers) : []}
            rule={selected}
            titleEditing={titleEditing}
            onTitleEditing={setTitleEditing}
            onUpdate={(patch) => (selected ? updateRule(selected.id, patch) : Promise.resolve())}
            onClose={() => {
              setSelectedId(undefined);
              setTitleEditing(false);
            }}
          />
        )}
      </Flexbox>
    </Flexbox>
  );
};

export default MemoryRules;
