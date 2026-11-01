'use client';

import { Github } from '@lobehub/icons';
import { Flexbox, Icon, Popover, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckIcon, ChevronDownIcon, SquircleDashed } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { useTopicRepoSelection } from './useTopicRepoSelection';

const styles = stylex.create({
  button: {
    cursor: 'pointer',
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    paddingBlock: '2px',
    paddingInline: '4px',
    borderRadius: '4px',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    transition: 'background 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  buttonDisabled: {
    cursor: 'not-allowed',
    opacity: 0.5,
    backgroundColor: { 'default': null, ':hover': 'transparent' },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  checkIndicator: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    borderWidth: '1.5px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: '4px',
  },
  checkIndicatorChecked: {
    borderColor: cssVar.colorPrimary,
    color: '#fff',
    backgroundColor: cssVar.colorPrimary,
    backgroundImage: 'none',
  },
  repoItem: {
    cursor: 'pointer',
    paddingBlock: '6px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadius,
    transition: 'background-color 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  repoName: { fontSize: '13px', fontWeight: 500, color: cssVar.colorText },
  repoUrl: {
    overflow: 'hidden',
    fontSize: '11px',
    color: cssVar.colorTextDescription,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  scrollContainer: { overflowY: 'auto', maxHeight: '360px' },
  sectionTitle: {
    paddingBlockStart: '6px',
    paddingBlockEnd: '2px',
    paddingInline: '8px',
    fontSize: '11px',
    fontWeight: 500,
    color: cssVar.colorTextQuaternary,
  },
});

const getRepoName = (repo: string) => repo.split('/').findLast(Boolean) || repo;

interface CloudRepoSwitcherProps {
  agentId: string;
}

const CloudRepoSwitcher = memo<CloudRepoSwitcherProps>(({ agentId }) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const { allowed: canCreateContent, reason } = usePermission('create_content');

  // Available repos configured on the agent
  const availableRepos: string[] = useAgentStore((s) => {
    const env = agentByIdSelectors.getAgencyConfigById(agentId)(s)?.heterogeneousProvider?.env;
    try {
      return JSON.parse(env?.GITHUB_REPOS ?? '[]');
    } catch {
      return [];
    }
  });

  const { displayRepos, toggleRepo } = useTopicRepoSelection(agentId, canCreateContent);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!canCreateContent) return;

      setOpen(nextOpen);
    },
    [canCreateContent],
  );

  if (availableRepos.length === 0) return null;

  // Button label
  const buttonLabel =
    displayRepos.length === 0
      ? t('heteroAgent.cloudRepo.notSet')
      : displayRepos.length === 1
        ? getRepoName(displayRepos[0])
        : t('heteroAgent.cloudRepo.multiSelected', { count: displayRepos.length });

  const content = (
    <Flexbox gap={4} style={{ minWidth: 280 }}>
      <div {...stylex.props(styles.sectionTitle)}>{t('heteroAgent.cloudRepo.sectionTitle')}</div>
      <div {...stylex.props(styles.scrollContainer)}>
        {availableRepos.map((repo) => {
          const isChecked = displayRepos.includes(repo);
          return (
            <Flexbox
              horizontal
              align="center"
              className={stylex.props(styles.repoItem).className}
              gap={8}
              key={repo}
              onClick={() => toggleRepo(repo)}
            >
              <div
                {...stylex.props(styles.checkIndicator, isChecked && styles.checkIndicatorChecked)}
              >
                {isChecked && <Icon icon={CheckIcon} size={12} />}
              </div>
              <Github size={16} style={{ color: cssVar.colorTextTertiary, flex: 'none' }} />
              <Flexbox flex={1} style={{ minWidth: 0 }}>
                <div {...stylex.props(styles.repoName)}>{getRepoName(repo)}</div>
                <div {...stylex.props(styles.repoUrl)}>{repo}</div>
              </Flexbox>
            </Flexbox>
          );
        })}
      </div>
    </Flexbox>
  );

  const button = (
    <div {...stylex.props(styles.button, !canCreateContent && styles.buttonDisabled)}>
      {displayRepos.length > 0 ? <Github size={14} /> : <Icon icon={SquircleDashed} size={14} />}
      <span>{buttonLabel}</span>
      <Icon icon={ChevronDownIcon} size={12} />
    </div>
  );

  if (!canCreateContent)
    return (
      <Tooltip title={reason}>
        <div>{button}</div>
      </Tooltip>
    );

  return (
    <Popover
      content={content}
      open={canCreateContent && open}
      placement="bottomLeft"
      styles={{ content: { padding: 4 } }}
      trigger="click"
      onOpenChange={handleOpenChange}
    >
      {button}
    </Popover>
  );
});

CloudRepoSwitcher.displayName = 'CloudRepoSwitcher';

export default CloudRepoSwitcher;
