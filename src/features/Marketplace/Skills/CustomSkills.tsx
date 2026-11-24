import { ActionIcon, confirmModal, createModal, DropdownMenu, Icon, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { MoreHorizontalIcon, Trash2Icon } from 'lucide-react';
import { lazy, memo, Suspense, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/selectors';
import type { AgentSkillListItem } from '@/store/tool/slices/agentSkills/projection';

import { customSkillsOf } from './customSkillFilter';
import { Row } from './github/GithubRows';
import SkillIcon from './SkillIcon';
import { useUninstallLibrarySkill } from './useUninstallLibrarySkill';

const AgentSkillDetail = lazy(() => import('@/features/AgentSkillDetail'));

const styles = stylex.create({
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    columnGap: 16,
    rowGap: 4,
  },
});

/** The user's own skills that came from neither the market nor GitHub. */
export const useCustomSkills = (query = '') => {
  const skills = useToolStore(agentSkillsSelectors.getUserAgentSkills);
  return useMemo(() => customSkillsOf(skills, query), [query, skills]);
};

/**
 * A custom skill: opening it shows its SKILL.md and files; its menu uninstalls it.
 * The library holds its only copy, so uninstalling asks first.
 */
const CustomSkillRow = memo<{ skill: AgentSkillListItem }>(({ skill }) => {
  const { t } = useTranslation('setting');
  const { t: tp } = useTranslation('plugin');
  const { failed, removing, uninstall } = useUninstallLibrarySkill(skill.id);

  const openDetail = () =>
    createModal({
      content: (
        <Suspense fallback={<div style={{ height: '100%' }} />}>
          <AgentSkillDetail skillId={skill.id} />
        </Suspense>
      ),
      footer: null,
      styles: { content: { height: 'calc(100dvh - 200px)', overflow: 'hidden', padding: 0 } },
      title: tp('dev.title.skillDetails'),
      width: 960,
    });

  const confirmUninstall = () =>
    confirmModal({
      content: tp('store.actions.confirmUninstall'),
      okButtonProps: { danger: true },
      okText: tp('store.actions.uninstall'),
      onOk: uninstall,
      title: tp('store.actions.uninstall'),
    });

  return (
    <Row
      icon={<SkillIcon size={40} />}
      title={skill.name}
      action={
        <DropdownMenu
          placement={'bottomRight'}
          items={[
            {
              danger: true,
              icon: <Icon icon={Trash2Icon} />,
              key: 'uninstall',
              label: t('market.skills.uninstall'),
              onClick: confirmUninstall,
            },
          ]}
        >
          <ActionIcon
            icon={MoreHorizontalIcon}
            loading={removing}
            title={t('connectorMarket.action.manage')}
          />
        </DropdownMenu>
      }
      subtitle={
        <Text ellipsis fontSize={12} type={failed ? 'danger' : 'secondary'}>
          {failed ? t('market.skills.uninstallFailed') : skill.description}
        </Text>
      }
      onOpen={openDetail}
    />
  );
});

CustomSkillRow.displayName = 'MarketCustomSkillRow';

export const CustomSkills = memo<{ items: AgentSkillListItem[] }>(({ items }) => (
  <div {...stylex.props(styles.grid)}>
    {items.map((skill) => (
      <CustomSkillRow key={skill.id} skill={skill} />
    ))}
  </div>
));

CustomSkills.displayName = 'MarketCustomSkills';
