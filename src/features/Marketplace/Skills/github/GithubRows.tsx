import type { GitHubSkillCheck } from '@lobechat/types';
import { ActionIcon, Avatar, Button, DropdownMenu, Icon, Text } from '@lobehub/ui';
import { GithubIcon } from '@lobehub/ui/icons';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ExternalLinkIcon, MoreHorizontalIcon, StarIcon, Trash2Icon } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';
import type { AgentSkillListItem } from '@/store/tool/slices/agentSkills/projection';

import IconTile from '../IconTile';
import SkillIcon from '../SkillIcon';
import { githubSkillRepo } from './githubInstalled';
import type { GithubRepoHit } from './searchGithubRepos';
import { useApplyGithubUpdate } from './useGithubSkillUpdates';

const styles = stylex.create({
  action: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    gap: 4,
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

/** The cell every GitHub row shares with the Market's skill rows: icon, two lines, an action. */
const Row = ({
  action,
  icon,
  onOpen,
  subtitle,
  title,
}: {
  action?: ReactNode;
  icon: ReactNode;
  onOpen: () => void;
  subtitle: ReactNode;
  title: ReactNode;
}) => (
  <div {...stylex.props(styles.row)} onClick={onOpen}>
    {icon}
    <span {...stylex.props(styles.text)}>
      <Text ellipsis weight={500}>
        {title}
      </Text>
      {subtitle}
    </span>
    {action && (
      <span {...stylex.props(styles.action)} onClick={(event) => event.stopPropagation()}>
        {action}
      </span>
    )}
  </div>
);

const GithubTile = memo<{ avatar?: string; size: number }>(({ avatar, size }) => (
  <IconTile size={size}>
    {avatar ? (
      <Avatar avatar={avatar} shape={'square'} size={size} />
    ) : (
      <GithubIcon size={Math.round(size * 0.5)} />
    )}
  </IconTile>
));

GithubTile.displayName = 'MarketGithubTile';

/** A typed or pasted GitHub address, offered as the first search result. */
export const GithubAddressRow = memo<{ onOpen: () => void; repo: string }>(({ onOpen, repo }) => {
  const { t } = useTranslation('setting');
  return (
    <Row
      icon={<GithubTile size={40} />}
      title={repo}
      subtitle={
        <Text ellipsis fontSize={12} type={'secondary'}>
          {t('market.skills.github.addressHint')}
        </Text>
      }
      onOpen={onOpen}
    />
  );
});

GithubAddressRow.displayName = 'MarketGithubAddressRow';

/** A public repository from GitHub search; opening it scans it for skills. */
export const GithubRepoRow = memo<{ hit: GithubRepoHit; onOpen: () => void }>(({ hit, onOpen }) => (
  <Row
    icon={<GithubTile avatar={hit.avatar} size={40} />}
    title={hit.fullName}
    action={
      <Text fontSize={12} type={'secondary'}>
        <Icon icon={StarIcon} size={12} /> {hit.stars.toLocaleString()}
      </Text>
    }
    subtitle={
      hit.description ? (
        <Text ellipsis fontSize={12} type={'secondary'}>
          {hit.description}
        </Text>
      ) : undefined
    }
    onOpen={onOpen}
  />
));

GithubRepoRow.displayName = 'MarketGithubRepoRow';

/**
 * A skill installed from GitHub: its repository under the name, and an Update
 * button when GitHub has a newer version. Its menu opens it on GitHub or
 * uninstalls it; the row itself opens its repository page to rescan.
 */
export const GithubSkillRow = memo<{
  check?: GitHubSkillCheck;
  onOpen: () => void;
  skill: AgentSkillListItem;
}>(({ check, onOpen, skill }) => {
  const { t } = useTranslation('setting');
  const deleteAgentSkill = useToolStore((s) => s.deleteAgentSkill);
  const { error, pending, update } = useApplyGithubUpdate(skill.id, check);
  const [removing, setRemoving] = useState(false);
  const repo = githubSkillRepo(skill);
  const sourceUrl = skill.manifest?.sourceUrl ?? (repo ? `https://github.com/${repo}` : undefined);

  const uninstall = async () => {
    setRemoving(true);
    try {
      await deleteAgentSkill(skill.id);
    } catch (cause) {
      console.warn('[Market] Failed to uninstall skill:', cause);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Row
      icon={<SkillIcon size={40} />}
      title={skill.name}
      action={
        <>
          {check?.status === 'update' && (
            <Button loading={pending} type={'fill'} onClick={update}>
              {t('market.skills.github.updateOne')}
            </Button>
          )}
          <DropdownMenu
            placement={'bottomRight'}
            items={[
              ...(sourceUrl
                ? [
                    {
                      icon: <Icon icon={ExternalLinkIcon} />,
                      key: 'open',
                      label: t('market.skills.github.openOnGithub'),
                      onClick: () => window.open(sourceUrl, '_blank', 'noopener,noreferrer'),
                    },
                  ]
                : []),
              {
                danger: true,
                icon: <Icon icon={Trash2Icon} />,
                key: 'uninstall',
                label: t('market.skills.uninstall'),
                onClick: () => void uninstall(),
              },
            ]}
          >
            <ActionIcon icon={MoreHorizontalIcon} loading={removing} />
          </DropdownMenu>
        </>
      }
      subtitle={
        <Text ellipsis fontSize={12} type={error ? 'danger' : 'secondary'}>
          {error
            ? t('market.skills.github.updateFailed')
            : [repo, skill.description].filter(Boolean).join(' · ')}
        </Text>
      }
      onOpen={onOpen}
    />
  );
});

GithubSkillRow.displayName = 'MarketGithubSkillRow';
