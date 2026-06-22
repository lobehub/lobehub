'use client';

import type { ClaudeCodeReasoningEffort, HeterogeneousProviderConfig } from '@lobechat/types';
import {
  CLAUDE_CODE_REASONING_EFFORT_LEVELS,
  resolveClaudeCodeModel,
  resolveClaudeCodeReasoningEffort,
} from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import {
  DropdownMenuItem,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuSubmenuRoot,
  DropdownMenuSubmenuTrigger,
  DropdownMenuTrigger,
  Tooltip,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { CheckIcon, ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../hooks/useAgentId';

const MODEL_OPTIONS = [
  { label: 'Opus 4.8', value: 'opus' },
  { label: 'Sonnet 4.6', value: 'sonnet' },
  { label: 'Haiku 4.5', value: 'haiku' },
] as const;

const MODEL_LABELS: Record<string, string> = Object.fromEntries(
  MODEL_OPTIONS.map((option) => [option.value, option.label]),
);

const EFFORT_LABEL_KEYS = {
  high: 'heteroAgent.modelSelector.reasoning.high',
  low: 'heteroAgent.modelSelector.reasoning.low',
  max: 'heteroAgent.modelSelector.reasoning.max',
  medium: 'heteroAgent.modelSelector.reasoning.medium',
  xhigh: 'heteroAgent.modelSelector.reasoning.xhigh',
} as const satisfies Record<ClaudeCodeReasoningEffort, string>;

const styles = createStaticStyles(({ css }) => ({
  check: css`
    flex: none;
    color: ${cssVar.colorTextSecondary};
  `,
  divider: css`
    height: 1px;
    margin-block: 6px;
    background: ${cssVar.colorSplit};
  `,
  label: css`
    overflow: hidden;
    max-width: 150px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  option: css`
    cursor: pointer;

    display: flex;
    gap: 18px;
    align-items: center;
    justify-content: space-between;

    min-height: 34px;
    padding-inline: 10px;
    border-radius: 8px;

    font-size: 14px;
    line-height: 1.2;
    color: ${cssVar.colorText};

    transition: background-color 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  optionLabel: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  popup: css`
    padding: 8px;
    border-radius: 16px;
    background: ${cssVar.colorBgElevated};
    box-shadow:
      0 0 0 1px ${cssVar.colorBorderSecondary},
      0 12px 32px rgb(0 0 0 / 10%),
      0 4px 12px rgb(0 0 0 / 8%);
  `,
  scroll: css`
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    max-height: 250px;
  `,
  sectionTitle: css`
    padding-block: 0 8px;
    padding-inline: 10px;

    font-size: 13px;
    line-height: 1.2;
    color: ${cssVar.colorTextQuaternary};
  `,
  submenuTrigger: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    min-height: 34px;
    padding-inline: 10px;
    border-radius: 8px;

    font-size: 14px;
    color: ${cssVar.colorText};
  `,
  submenuMeta: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  submenuTrail: css`
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;

    color: ${cssVar.colorTextSecondary};
  `,
  trigger: css`
    cursor: pointer;

    display: flex;
    flex: none;
    gap: 6px;
    align-items: center;

    height: 28px;
    padding-inline: 8px;
    border-radius: 6px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;

    transition: all 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  triggerDisabled: css`
    cursor: not-allowed;
    opacity: 0.5;

    &:hover {
      color: ${cssVar.colorTextSecondary};
      background: transparent;
    }
  `,
}));

const stripCliFlag = (args: string[] | undefined, flag: string): string[] | undefined => {
  if (!args) return undefined;

  const next: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === flag) {
      const value = args[index + 1];
      if (value && !value.startsWith('-')) index += 1;
      continue;
    }
    if (arg.startsWith(`${flag}=`)) continue;

    next.push(arg);
  }

  return next;
};

const getModelLabel = (model: string) => {
  const aliasLabel = MODEL_LABELS[model];
  if (aliasLabel) return aliasLabel;

  const match = /^claude-(opus|sonnet|haiku)-(\d+)-(\d+)/.exec(model);
  if (!match) return model;

  const [, family, major, minor] = match;
  return `${family[0].toUpperCase()}${family.slice(1)} ${major}.${minor}`;
};

const HeteroModel = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const provider = useAgentStore(
    (s) => agentByIdSelectors.getAgencyConfigById(agentId)(s)?.heterogeneousProvider,
    isEqual,
  );
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
  const { allowed: canCreateContent, reason } = usePermission('create_content');
  const [open, setOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);

  const patchProvider = useCallback(
    async (patch: Partial<Pick<HeterogeneousProviderConfig, 'effort' | 'model'>>) => {
      if (!canCreateContent || !agentId) return;

      const nextPatch: Partial<HeterogeneousProviderConfig> = { ...patch };
      if ('model' in patch) nextPatch.args = stripCliFlag(provider?.args, '--model');
      if ('effort' in patch) {
        nextPatch.args = stripCliFlag(nextPatch.args ?? provider?.args, '--effort');
      }

      await updateAgentConfigById(agentId, {
        agencyConfig: { heterogeneousProvider: nextPatch },
      });
    },
    [agentId, canCreateContent, provider?.args, updateAgentConfigById],
  );
  const closeMenu = useCallback(() => {
    setOpen(false);
    setModelOpen(false);
  }, []);
  const handleOpenChange = useCallback((value: boolean) => {
    setOpen(value);
    if (!value) setModelOpen(false);
  }, []);
  const selectModel = useCallback(
    (value: string) => {
      closeMenu();
      void patchProvider({ model: value });
    },
    [closeMenu, patchProvider],
  );
  const selectReasoningEffort = useCallback(
    (value: ClaudeCodeReasoningEffort) => {
      closeMenu();
      void patchProvider({ effort: value });
    },
    [closeMenu, patchProvider],
  );

  if (provider?.type !== 'claude-code') return null;

  const model = resolveClaudeCodeModel(provider);
  const effort = resolveClaudeCodeReasoningEffort(provider);
  const modelLabel = getModelLabel(model);
  const effortLabel = t(EFFORT_LABEL_KEYS[effort]);
  const effortOptions = CLAUDE_CODE_REASONING_EFFORT_LEVELS.map((level) => ({
    label: t(EFFORT_LABEL_KEYS[level]),
    value: level,
  }));
  const modelOptions = MODEL_OPTIONS.some((option) => option.value === model)
    ? MODEL_OPTIONS
    : [{ label: model, value: model }, ...MODEL_OPTIONS];
  const triggerText = `${modelLabel} · ${effortLabel}`;

  const trigger = (
    <div
      className={cx(styles.trigger, !canCreateContent && styles.triggerDisabled)}
      aria-label={t('heteroAgent.modelSelector.ariaLabel', {
        model: modelLabel,
        reasoning: effortLabel,
      })}
    >
      <span className={styles.label}>{triggerText}</span>
      <Icon icon={ChevronDownIcon} size={12} />
    </div>
  );

  if (!canCreateContent)
    return (
      <Tooltip title={reason}>
        <div>{trigger}</div>
      </Tooltip>
    );

  const renderOption = <T extends string>(
    title: string,
    options: readonly { label: string; value: T }[],
    current: T,
    onSelect: (value: T) => void,
  ) =>
    options.map((option) => (
      <DropdownMenuItem
        className={styles.option}
        data-selected={current === option.value ? 'true' : undefined}
        key={`${title}-${option.value}`}
        onClick={() => void onSelect(option.value)}
      >
        <span className={styles.optionLabel}>{option.label}</span>
        {current === option.value && <Icon className={styles.check} icon={CheckIcon} size={16} />}
      </DropdownMenuItem>
    ));

  return (
    <DropdownMenuRoot open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger nativeButton={false}>{trigger}</DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuPositioner placement="topRight" sideOffset={8}>
          <DropdownMenuPopup className={styles.popup} style={{ width: 208 }}>
            <div className={styles.sectionTitle}>{t('heteroAgent.modelSelector.reasoning')}</div>
            <div className={styles.scroll}>
              {renderOption('reasoning', effortOptions, effort, selectReasoningEffort)}
            </div>
            <DropdownMenuSeparator className={styles.divider} />
            <DropdownMenuSubmenuRoot open={modelOpen} onOpenChange={setModelOpen}>
              <DropdownMenuSubmenuTrigger
                className={styles.submenuTrigger}
                onMouseEnter={() => setModelOpen(true)}
                onClick={(event) => {
                  event.preventDefault();
                  setModelOpen(true);
                }}
              >
                <span className={styles.submenuMeta}>{modelLabel}</span>
                <span className={styles.submenuTrail}>
                  <Icon icon={ChevronRightIcon} size={16} />
                </span>
              </DropdownMenuSubmenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuPositioner
                  alignOffset={-4}
                  anchor={null}
                  placement="right"
                  sideOffset={8}
                >
                  <DropdownMenuPopup className={styles.popup} style={{ minWidth: 200 }}>
                    <div className={styles.sectionTitle}>
                      {t('heteroAgent.modelSelector.model')}
                    </div>
                    <div className={styles.scroll}>
                      {renderOption('model', modelOptions, model, selectModel)}
                    </div>
                  </DropdownMenuPopup>
                </DropdownMenuPositioner>
              </DropdownMenuPortal>
            </DropdownMenuSubmenuRoot>
          </DropdownMenuPopup>
        </DropdownMenuPositioner>
      </DropdownMenuPortal>
    </DropdownMenuRoot>
  );
});

HeteroModel.displayName = 'HeteroModel';

export default HeteroModel;
