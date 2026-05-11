'use client';

import { Github } from '@lobehub/icons';
import { Flexbox, Icon, Popover } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CheckIcon, ChevronDownIcon, SquircleDashed } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { getPendingTopicRepos, setPendingTopicRepos } from '@/store/chat/pendingTopicRepos';
import { topicSelectors } from '@/store/chat/selectors';

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
    text-transform: uppercase;
    letter-spacing: 0.5px;
  `,
}));

const getRepoName = (repo: string) => repo.split('/').findLast(Boolean) || repo;

interface CloudRepoSwitcherProps {
  agentId: string;
}

const CloudRepoSwitcher = memo<CloudRepoSwitcherProps>(({ agentId }) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  // Incremented to trigger re-renders when the module-singleton pending selection changes.
  const [, forceUpdate] = useState(0);

  // Available repos configured on the agent
  const availableRepos: string[] = useAgentStore((s) => {
    const env = agentByIdSelectors.getAgencyConfigById(agentId)(s)?.heterogeneousProvider?.env;
    try {
      return JSON.parse(env?.GITHUB_REPOS ?? '[]');
    } catch {
      return [];
    }
  });

  // Repos persisted to the current topic (empty when no topic or none set)
  const topicRepos: string[] = useChatStore((s) => {
    const meta = topicSelectors.currentTopicMetadata(s);
    return meta?.repos ?? [];
  });

  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const updateTopicMetadata = useChatStore((s) => s.updateTopicMetadata);

  const currentWorkingDirectory = useChatStore(
    (s) => topicSelectors.currentTopicMetadata(s)?.workingDirectory,
  );

  const toggleRepo = useCallback(
    async (repo: string) => {
      if (!activeTopicId) {
        // No topic yet — buffer in the module singleton keyed by agentId.
        // gateway.ts will read and consume this when the first message creates a topic.
        const prev = getPendingTopicRepos(agentId);
        const isSelected = prev.includes(repo);
        const next = isSelected ? prev.filter((r) => r !== repo) : [...prev, repo];
        setPendingTopicRepos(agentId, next);
        forceUpdate((v) => v + 1);
        return;
      }

      const isSelected = topicRepos.includes(repo);
      const nextRepos = isSelected ? topicRepos.filter((r) => r !== repo) : [...topicRepos, repo];

      // Only set workingDirectory when it hasn't been assigned yet (first selection).
      // Once set, it stays fixed so the topic keeps its sidebar grouping.
      const patch: { repos: string[]; workingDirectory?: string } = { repos: nextRepos };
      if (!currentWorkingDirectory && nextRepos.length > 0) {
        patch.workingDirectory = nextRepos[0];
      }

      await updateTopicMetadata(activeTopicId, patch);
    },
    [agentId, activeTopicId, currentWorkingDirectory, topicRepos, updateTopicMetadata],
  );

  if (availableRepos.length === 0) return null;

  // When a topic exists, show its persisted repos.
  // When no topic exists yet, show the pending selection from the module singleton.
  const displayRepos = activeTopicId ? topicRepos : getPendingTopicRepos(agentId);

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

  return (
    <Popover
      content={content}
      open={open}
      placement="bottomLeft"
      styles={{ content: { padding: 4 } }}
      trigger="click"
      onOpenChange={setOpen}
    >
      <div className={styles.button}>
        {displayRepos.length > 0 ? <Github size={14} /> : <Icon icon={SquircleDashed} size={14} />}
        <span>{buttonLabel}</span>
        <Icon icon={ChevronDownIcon} size={12} />
      </div>
    </Popover>
  );
});

CloudRepoSwitcher.displayName = 'CloudRepoSwitcher';

export default CloudRepoSwitcher;
