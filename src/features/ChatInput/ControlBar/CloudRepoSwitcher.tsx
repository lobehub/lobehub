'use client';

import { Github } from '@lobehub/icons';
import { createStaticStyles, cssVar, cx, Flexbox, Icon, Popover, Tooltip } from '@lobehub/ui';
import { CheckIcon, ChevronDownIcon, SquircleDashed } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { useTopicRepoSelection } from './useTopicRepoSelection';

const styles = createStaticStyles(({ css }) => ({
  button: css`
    cursor: pointer;

    display: flex;
    gap: 6px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 4px;
    border-radius: 4px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    transition: background 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  buttonDisabled: css`
    cursor: not-allowed;
    opacity: 0.5;

    &:hover {
      background: transparent;
    }
  `,
  checkIndicator: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 20px;
    height: 20px;
    border: 1.5px solid ${cssVar.colorBorder};
    border-radius: 4px;
  `,
  checkIndicatorChecked: css`
    border-color: ${cssVar.colorPrimary};
    color: #fff;
    background: ${cssVar.colorPrimary};
  `,
  repoItem: css`
    cursor: pointer;

    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    transition: background-color 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  repoName: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  repoUrl: css`
    overflow: hidden;

    font-size: 11px;
    color: ${cssVar.colorTextDescription};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  scrollContainer: css`
    overflow-y: auto;
    max-height: 360px;
  `,
  sectionTitle: css`
    padding-block: 6px 2px;
    padding-inline: 8px;

    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

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
      <div className={styles.sectionTitle}>{t('heteroAgent.cloudRepo.sectionTitle')}</div>
      <div className={styles.scrollContainer}>
        {availableRepos.map((repo) => {
          const isChecked = displayRepos.includes(repo);
          return (
            <Flexbox
              horizontal
              align="center"
              className={styles.repoItem}
              gap={8}
              key={repo}
              onClick={() => toggleRepo(repo)}
            >
              <div
                className={`${styles.checkIndicator} ${isChecked ? styles.checkIndicatorChecked : ''}`}
              >
                {isChecked && <Icon icon={CheckIcon} size={12} />}
              </div>
              <Github size={16} style={{ color: cssVar.colorTextTertiary, flex: 'none' }} />
              <Flexbox flex={1} style={{ minWidth: 0 }}>
                <div className={styles.repoName}>{getRepoName(repo)}</div>
                <div className={styles.repoUrl}>{repo}</div>
              </Flexbox>
            </Flexbox>
          );
        })}
      </div>
    </Flexbox>
  );

  const button = (
    <div className={cx(styles.button, !canCreateContent && styles.buttonDisabled)}>
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
