import { ActionIcon, DropdownMenu, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { MoreHorizontalIcon, Trash2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDiscoverStore } from '@/store/discover';
import { skillSelectors } from '@/store/discover/selectors';

import RowAddAction from './RowAddAction';
import SkillAgentStatus from './SkillAgentStatus';
import SkillIcon from './SkillIcon';
import { useMarketSkillInstall } from './useMarketSkillInstall';
import { useSkillAgentStatus } from './useSkillAgents';

const styles = stylex.create({
  action: {
    display: 'flex',
    flex: 'none',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
    paddingBlock: 8,
    paddingInline: 8,
    borderRadius: cssVar.borderRadiusLG,
    cursor: 'pointer',
    backgroundColor: {
      'default': 'transparent',
      ':hover': cssVar.colorFillQuaternary,
    },
  },
  text: {
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    minWidth: 0,
  },
});

/**
 * The skill's market category. Installed skills come without one, so their
 * (cached) market detail supplies it and the icon keeps its color.
 */
const useSkillCategory = (skill: SkillSummary) => {
  const useFetchSkillDetail = useDiscoverStore((s) => s.useFetchSkillDetail);
  const { queryKey } = useFetchSkillDetail(
    { identifier: skill.identifier },
    { enabled: !skill.category },
  );
  const detail = useDiscoverStore(skillSelectors.skillDetail(queryKey));
  return skill.category ?? detail?.category;
};

/** What a skill cell shows; both market rows and installed skills map onto it. */
export interface SkillSummary {
  /** Market category; it picks the icon's color and glyph. Installed skills have none. */
  category?: string;
  description?: string | null;
  identifier: string;
  name: string;
}

/**
 * One skill cell: icon, name and blurb. A "+" installs it; an installed one has a "…" menu.
 * In "Installed" (`showAgents`), how many assistants have it on replaces the menu once
 * known; uninstalling lives on the skill's page there. Installing from a row opens the page.
 */
const SkillRow = memo<{ onOpen: () => void; showAgents?: boolean; skill: SkillSummary }>(
  ({ onOpen, showAgents = false, skill }) => {
    const agents = useSkillAgentStatus(skill.identifier, showAgents);
    const category = useSkillCategory(skill);
    const { t } = useTranslation('setting');
    const { error, install, installed, pending, uninstall } = useMarketSkillInstall(
      skill.identifier,
    );

    return (
      <div {...stylex.props(styles.row)} onClick={onOpen}>
        <SkillIcon category={category} size={40} />
        <span {...stylex.props(styles.text)}>
          <Text ellipsis weight={500}>
            {skill.name}
          </Text>
          <Text ellipsis fontSize={12} type={error ? 'danger' : 'secondary'}>
            {error ? t('market.skills.installFailed') : skill.description}
          </Text>
        </span>
        {showAgents && agents ? (
          <SkillAgentStatus agents={agents} />
        ) : (
          <span {...stylex.props(styles.action)} onClick={(event) => event.stopPropagation()}>
            {installed ? (
              <DropdownMenu
                placement={'bottomRight'}
                items={[
                  {
                    danger: true,
                    icon: <Icon icon={Trash2Icon} />,
                    key: 'uninstall',
                    label: t('market.skills.uninstall'),
                    onClick: () => void uninstall(),
                  },
                ]}
              >
                <ActionIcon icon={MoreHorizontalIcon} loading={pending} />
              </DropdownMenu>
            ) : (
              <RowAddAction
                loading={pending}
                title={t('market.skills.install')}
                onClick={async () => {
                  // A skill added from the list opens its page, where it goes onto assistants.
                  if (await install()) onOpen();
                }}
              />
            )}
          </span>
        )}
      </div>
    );
  },
);

SkillRow.displayName = 'MarketSkillRow';

export default SkillRow;
