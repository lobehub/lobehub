'use client';

import { Github } from '@lobehub/icons';
import { Flexbox, Icon, Popover, Tooltip } from '@lobehub/ui';
import { Checkbox, Text } from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import { CheckIcon, ChevronDownIcon, SquircleDashed } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatLockedControlTooltip } from '@/features/ChatInput/utils/lockedControlTooltip';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { taskExecutionStyles as styles } from './taskExecutionStyles';

interface TaskRepoChipProps {
  /** The assignee whose configured repos are offered. */
  agentId: string;
  /**
   * Row class for the trigger. Omitted → the composer's compact chip; the task
   * detail's header row passes its own chip-sized class instead.
   */
  className?: string;
  disabled?: boolean;
  /** Selected repos, or `undefined` to inherit (the agent's own directory). */
  onChange: (repos: string[] | undefined) => void;
  value?: string[];
}

const getRepoName = (repo: string) => repo.split('/').findLast(Boolean) || repo;

/**
 * The working directory a task's runs start in, expressed as a repo selection.
 *
 * Only offered when the run lands in the cloud sandbox — the caller decides
 * that from the task's TARGET, because a repo identifier is the directory only
 * there. On a machine the directory is a path, and a repo name stored as one
 * would be a value the run cannot use.
 *
 * Reads the same source the chat composer's repo switcher does — the agent's
 * `heterogeneousProvider.env.GITHUB_REPOS` — so the two surfaces cannot offer
 * different repo sets for the same agent. An empty selection means "inherit":
 * the run falls back to the agent's per-device directory and then the device
 * default.
 */
const TaskRepoChip = memo<TaskRepoChipProps>(
  ({ agentId, className, disabled, onChange, value }) => {
    const { t } = useTranslation('chat');
    const [open, setOpen] = useState(false);

    const availableRepos: string[] = useAgentStore((s) => {
      const env = agentByIdSelectors.getAgencyConfigById(agentId)(s)?.heterogeneousProvider?.env;
      try {
        return JSON.parse(env?.GITHUB_REPOS ?? '[]');
      } catch {
        return [];
      }
    });

    // Memoized so `toggleRepo` stays stable — `value ?? []` would mint a new
    // array on every render and invalidate the callback each time.
    const selected = useMemo(() => value ?? [], [value]);

    const toggleRepo = useCallback(
      (repo: string) => {
        if (disabled) return;
        const next = selected.includes(repo)
          ? selected.filter((item) => item !== repo)
          : [...selected, repo];
        // An empty selection is inheritance, not "no directory" — collapse it
        // back to undefined so only the intent is persisted.
        onChange(next.length > 0 ? next : undefined);
      },
      [disabled, onChange, selected],
    );

    // No configured repos means no repo surface for this agent at all — better
    // absent than an empty picker that can only ever say "nothing here".
    if (availableRepos.length === 0) return null;

    const chipLabel =
      selected.length === 0
        ? t('taskExecution.followAgent')
        : selected.length === 1
          ? getRepoName(selected[0])
          : t('heteroAgent.cloudRepo.multiSelected', { count: selected.length });

    const content = (
      <Flexbox gap={4} style={{ minWidth: 280 }}>
        <div className={styles.sectionTitle}>{t('heteroAgent.cloudRepo.sectionTitle')}</div>
        <Flexbox
          horizontal
          align={'center'}
          className={`${styles.row} ${selected.length === 0 ? styles.rowActive : ''}`}
          gap={8}
          onClick={() => {
            if (disabled) return;
            onChange(undefined);
          }}
        >
          <Icon className={styles.icon} icon={SquircleDashed} size={16} />
          <Flexbox flex={1} style={{ minWidth: 0 }}>
            <div className={styles.rowTitle}>{t('taskExecution.followAgent')}</div>
            <div className={styles.rowDesc}>{t('taskExecution.followAgentDesc')}</div>
          </Flexbox>
          {selected.length === 0 && <Icon className={styles.check} icon={CheckIcon} size={14} />}
        </Flexbox>
        <div className={styles.scroll}>
          {availableRepos.map((repo) => {
            const isChecked = selected.includes(repo);
            return (
              <Flexbox
                horizontal
                align={'center'}
                className={styles.row}
                gap={8}
                key={repo}
                onClick={() => toggleRepo(repo)}
              >
                {/* The row is the control; the box reports the state. Rendered
                    through the design-system checkbox so the glyph, the corner
                    and the contrast follow the theme instead of a hand-rolled
                    box that only looked right in one of them. */}
                <span className={styles.checkboxSlot}>
                  <Checkbox checked={isChecked} />
                </span>
                <span className={styles.icon}>
                  <Github size={16} />
                </span>
                <Flexbox flex={1} style={{ minWidth: 0 }}>
                  <div className={styles.rowTitle}>{getRepoName(repo)}</div>
                  <div className={styles.rowDesc}>{repo}</div>
                </Flexbox>
              </Flexbox>
            );
          })}
        </div>
      </Flexbox>
    );

    // The muted directory trigger, not a chip — see `directoryTrigger`.
    const trigger = (
      <div className={cx(className ?? styles.directoryTrigger, disabled && styles.triggerDisabled)}>
        {selected.length > 0 ? <Github size={14} /> : <Icon icon={SquircleDashed} size={14} />}
        <Text ellipsis className={styles.chipLabel} fontSize={12}>
          {chipLabel}
        </Text>
        <Icon icon={ChevronDownIcon} size={12} />
      </div>
    );

    if (disabled) {
      return (
        <Tooltip
          title={formatLockedControlTooltip(
            t('taskExecution.workingDirectory'),
            t('taskExecution.fixedTip'),
          )}
        >
          {trigger}
        </Tooltip>
      );
    }

    return (
      <Popover
        content={content}
        open={open}
        placement="bottomLeft"
        styles={{ content: { padding: 4 } }}
        trigger="click"
        onOpenChange={setOpen}
      >
        {trigger}
      </Popover>
    );
  },
);

TaskRepoChip.displayName = 'TaskRepoChip';

export default TaskRepoChip;
