'use client';

import type {
  ClaudeCodeReasoningEffort,
  CodexReasoningEffort,
  HeterogeneousAgentDefaultSelection,
  HeterogeneousProviderConfig,
  HeterogeneousSpeedMode,
} from '@lobechat/types';
import {
  CLAUDE_CODE_REASONING_EFFORT_LEVELS,
  CODEX_REASONING_EFFORT_CONFIG_KEY,
  CODEX_SERVICE_TIER_CONFIG_KEY,
  codexModelSupportsFastSpeed,
  codexModelSupportsReasoningEffort,
  getCodexReasoningEffortLevels,
  HETEROGENEOUS_AGENT_DEFAULT_SELECTION,
  resolveClaudeCodeModel,
  resolveClaudeCodeReasoningEffort,
  resolveCodexModel,
  resolveCodexReasoningEffort,
  resolveCodexSpeedMode,
} from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import {
  DropdownMenuItem,
  DropdownMenuItemContent,
  DropdownMenuItemExtra,
  DropdownMenuItemLabel,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuSubmenuArrow,
  DropdownMenuSubmenuRoot,
  DropdownMenuSubmenuTrigger,
  DropdownMenuTrigger,
  Tooltip,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, ZapIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../hooks/useAgentId';
import { useChatInputResourceAccess } from '../hooks/useChatInputResourceAccess';
import { OpenCodeModelSelector } from './OpenCodeModelSelector';

type HeteroReasoningEffort =
  ClaudeCodeReasoningEffort | CodexReasoningEffort | HeterogeneousAgentDefaultSelection;

type SelectableHeteroProviderType = 'claude-code' | 'codex' | 'opencode';

const CLAUDE_CODE_MODEL_OPTIONS = [
  { label: 'Fable 5', value: 'fable' },
  { label: 'Opus 4.8', value: 'opus' },
  { label: 'Sonnet 4.6', value: 'sonnet' },
  { label: 'Haiku 4.5', value: 'haiku' },
] as const;

const CODEX_MODEL_OPTIONS = [
  { label: 'GPT-5.6 Sol', value: 'gpt-5.6-sol' },
  { label: 'GPT-5.6 Terra', value: 'gpt-5.6-terra' },
  { label: 'GPT-5.6 Luna', value: 'gpt-5.6-luna' },
  { label: 'GPT-5.5', value: 'gpt-5.5' },
  { label: 'GPT-5.4', value: 'gpt-5.4' },
  { label: 'GPT-5.4 Mini', value: 'gpt-5.4-mini' },
  { label: 'GPT-5.3 Codex Spark', value: 'gpt-5.3-codex-spark' },
] as const;

const MODEL_LABELS: Record<string, string> = {
  'gpt-5.6': 'GPT-5.6',
  ...Object.fromEntries(
    [...CLAUDE_CODE_MODEL_OPTIONS, ...CODEX_MODEL_OPTIONS].map((option) => [
      option.value,
      option.label,
    ]),
  ),
};

const EFFORT_LABEL_KEYS = {
  [HETEROGENEOUS_AGENT_DEFAULT_SELECTION]: 'heteroAgent.modelSelector.default',
  high: 'heteroAgent.modelSelector.reasoning.high',
  low: 'heteroAgent.modelSelector.reasoning.low',
  max: 'heteroAgent.modelSelector.reasoning.max',
  medium: 'heteroAgent.modelSelector.reasoning.medium',
  ultra: 'heteroAgent.modelSelector.reasoning.ultra',
  xhigh: 'heteroAgent.modelSelector.reasoning.xhigh',
} as const satisfies Record<HeteroReasoningEffort, string>;

/**
 * Codex renames the `low` effort to "Light" in its official app UI while the
 * CLI value stays `low`; Claude Code keeps the plain "Low" wording.
 */
const CODEX_EFFORT_LABEL_KEYS = {
  ...EFFORT_LABEL_KEYS,
  low: 'heteroAgent.modelSelector.reasoning.light',
} as const satisfies Record<HeteroReasoningEffort, string>;

const styles = createStaticStyles(({ css }) => ({
  check: css`
    flex: none;
    color: ${cssVar.colorTextSecondary};
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
  optionBody: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 3px;

    min-width: 0;
    padding-block: 7px;
  `,
  optionDesc: css`
    overflow: hidden;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  optionIcon: css`
    flex: none;
    color: ${cssVar.colorTextSecondary};
  `,
  optionLabel: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  optionTitle: css`
    display: flex;
    gap: 6px;
    align-items: center;
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
    min-height: 36px;
    padding-inline: 10px;
  `,
  submenuMeta: css`
    overflow: hidden;
    display: inline-flex;
    flex: none;
    gap: 4px;
    align-items: center;

    min-width: 0;
    max-width: 150px;
    padding-inline-start: 16px;

    font-family: inherit;
    font-size: 14px;
    color: ${cssVar.colorTextSecondary};
  `,
  submenuMetaLabel: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

interface SelectorSubmenuProps {
  children: ReactNode;
  currentValue: string;
  icon?: typeof ZapIcon;
  label: string;
  popupWidth?: number;
}

const SelectorSubmenu = ({
  children,
  currentValue,
  icon,
  label,
  popupWidth = 220,
}: SelectorSubmenuProps) => (
  <DropdownMenuSubmenuRoot>
    <DropdownMenuSubmenuTrigger className={styles.submenuTrigger} label={label} openOnHover={false}>
      <DropdownMenuItemContent>
        <DropdownMenuItemLabel>{label}</DropdownMenuItemLabel>
        <DropdownMenuItemExtra className={styles.submenuMeta}>
          {icon && <Icon className={styles.optionIcon} icon={icon} size={12} />}
          <span className={styles.submenuMetaLabel}>{currentValue}</span>
        </DropdownMenuItemExtra>
        <DropdownMenuSubmenuArrow>
          <Icon icon={ChevronRightIcon} size={12} />
        </DropdownMenuSubmenuArrow>
      </DropdownMenuItemContent>
    </DropdownMenuSubmenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuPositioner alignOffset={-4} anchor={null} placement="right" sideOffset={8}>
        <DropdownMenuPopup className={styles.popup} style={{ minWidth: popupWidth }}>
          <div className={styles.sectionTitle}>{label}</div>
          <div className={styles.scroll}>{children}</div>
        </DropdownMenuPopup>
      </DropdownMenuPositioner>
    </DropdownMenuPortal>
  </DropdownMenuSubmenuRoot>
);

const stripCliFlags = (
  args: string[] | undefined,
  flags: readonly string[],
): string[] | undefined => {
  if (!args) return undefined;

  const next: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (flags.includes(arg)) {
      const value = args[index + 1];
      if (value && !value.startsWith('-')) index += 1;
      continue;
    }
    if (flags.some((flag) => arg.startsWith(`${flag}=`))) continue;

    next.push(arg);
  }

  return next;
};

const parseCliConfigKey = (assignment: string): string | undefined => {
  const match = assignment.match(/^\s*([\w.-]+)\s*=/);
  return match?.[1];
};

const stripCodexConfigKey = (args: string[] | undefined, key: string): string[] | undefined => {
  if (!args) return undefined;

  const next: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '-c' || arg === '--config') {
      const value = args[index + 1];
      if (value && parseCliConfigKey(value) === key) {
        index += 1;
        continue;
      }

      next.push(arg);
      continue;
    }

    if (arg.startsWith('-c=') || arg.startsWith('--config=')) {
      const value = arg.slice(arg.indexOf('=') + 1);
      if (parseCliConfigKey(value) === key) continue;
    }

    next.push(arg);
  }

  return next;
};

const isSelectableProviderType = (
  type: HeterogeneousProviderConfig['type'] | undefined,
): type is SelectableHeteroProviderType =>
  type === 'claude-code' || type === 'codex' || type === 'opencode';

const getModelLabel = (model: string, defaultLabel: string) => {
  if (model === HETEROGENEOUS_AGENT_DEFAULT_SELECTION) return defaultLabel;

  const aliasLabel = MODEL_LABELS[model];
  if (aliasLabel) return aliasLabel;

  const match = /^claude-(opus|sonnet|haiku)-(\d+)-(\d+)/.exec(model);
  if (!match) return model;

  const [, family, major, minor] = match;
  return `${family[0].toUpperCase()}${family.slice(1)} ${major}.${minor}`;
};

const getTriggerText = ({
  defaultConfigLabel,
  defaultModelLabel,
  defaultReasoningLabel,
  effort,
  effortLabel,
  model,
  modelLabel,
}: {
  defaultConfigLabel: string;
  defaultModelLabel: string;
  defaultReasoningLabel: string;
  effort: HeteroReasoningEffort;
  effortLabel: string;
  model: string;
  modelLabel: string;
}) => {
  const isDefaultModel = model === HETEROGENEOUS_AGENT_DEFAULT_SELECTION;
  const isDefaultEffort = effort === HETEROGENEOUS_AGENT_DEFAULT_SELECTION;

  if (isDefaultModel && isDefaultEffort) return defaultConfigLabel;
  const resolvedModelLabel = isDefaultModel ? defaultModelLabel : modelLabel;
  const resolvedEffortLabel = isDefaultEffort ? defaultReasoningLabel : effortLabel;

  return `${resolvedModelLabel} ${resolvedEffortLabel}`;
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
  // Model/effort picks write the shared agencyConfig — view-only General
  // access disables the whole picker (disabled, not hidden).
  const { canUseResource, isGroupContext } = useChatInputResourceAccess();
  const enabled = canCreateContent && canUseResource;
  const [open, setOpen] = useState(false);

  const patchProvider = useCallback(
    async (patch: Partial<Pick<HeterogeneousProviderConfig, 'effort' | 'model' | 'speed'>>) => {
      if (!enabled || !agentId) return;

      const nextPatch: Partial<HeterogeneousProviderConfig> = { ...patch };
      const providerType = provider?.type;

      if (providerType === 'codex') {
        if ('model' in patch) {
          const args = stripCliFlags(provider?.args, ['--model', '-m']);
          nextPatch.args = stripCodexConfigKey(args, 'model');
        }
        if ('effort' in patch) {
          const sourceArgs = nextPatch.args ?? provider?.args;
          nextPatch.args = stripCodexConfigKey(sourceArgs, CODEX_REASONING_EFFORT_CONFIG_KEY);
        }
        if ('speed' in patch) {
          const sourceArgs = nextPatch.args ?? provider?.args;
          nextPatch.args = stripCodexConfigKey(sourceArgs, CODEX_SERVICE_TIER_CONFIG_KEY);
        }
      } else if (providerType === 'opencode') {
        if ('model' in patch) {
          nextPatch.args = stripCliFlags(provider?.args, ['--model', '-m']);
        }
      } else {
        if ('model' in patch) {
          nextPatch.args = stripCliFlags(provider?.args, ['--model']);
        }
        if ('effort' in patch) {
          const sourceArgs = nextPatch.args ?? provider?.args;
          nextPatch.args = stripCliFlags(sourceArgs, ['--effort']);
        }
      }

      await updateAgentConfigById(agentId, {
        agencyConfig: { heterogeneousProvider: nextPatch },
      });
    },
    [agentId, enabled, provider?.args, provider?.type, updateAgentConfigById],
  );
  const closeMenu = useCallback(() => {
    setOpen(false);
  }, []);
  const selectModel = useCallback(
    (value: string) => {
      closeMenu();
      // Fast speed only applies to supported Codex models — reset it when the
      // user switches away so the selector never claims a speed the run ignores.
      const resetSpeed =
        provider?.type === 'codex' &&
        resolveCodexSpeedMode(provider) === 'fast' &&
        !codexModelSupportsFastSpeed(value);
      const currentEffort =
        provider?.type === 'codex' ? resolveCodexReasoningEffort(provider) : undefined;
      const resetEffort =
        currentEffort !== undefined &&
        currentEffort !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION &&
        !codexModelSupportsReasoningEffort(value, currentEffort);

      void patchProvider({
        ...(resetEffort ? { effort: HETEROGENEOUS_AGENT_DEFAULT_SELECTION } : {}),
        model: value,
        ...(resetSpeed ? { speed: HETEROGENEOUS_AGENT_DEFAULT_SELECTION } : {}),
      });
    },
    [closeMenu, patchProvider, provider],
  );
  const selectReasoningEffort = useCallback(
    (value: HeteroReasoningEffort) => {
      closeMenu();
      void patchProvider({ effort: value });
    },
    [closeMenu, patchProvider],
  );
  const selectSpeedMode = useCallback(
    (value: HeterogeneousSpeedMode) => {
      closeMenu();
      void patchProvider({ speed: value });
    },
    [closeMenu, patchProvider],
  );

  if (!isSelectableProviderType(provider?.type)) return null;

  if (provider.type === 'opencode') {
    const model =
      provider.model && provider.model !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION
        ? provider.model
        : HETEROGENEOUS_AGENT_DEFAULT_SELECTION;

    return (
      <OpenCodeModelSelector
        agentId={agentId}
        disabled={!canCreateContent}
        model={model}
        permissionReason={reason}
        onSelect={(value) => void patchProvider({ model: value })}
      />
    );
  }

  const providerType = provider.type;
  const model =
    providerType === 'codex' ? resolveCodexModel(provider) : resolveClaudeCodeModel(provider);
  const effort =
    providerType === 'codex'
      ? resolveCodexReasoningEffort(provider)
      : resolveClaudeCodeReasoningEffort(provider);
  // Fast speed is a per-model capability: hide the whole Speed UI (submenu +
  // lightning icons) for models without the Fast tier. A stale persisted
  // `fast` on an unsupported model is ignored by the Codex CLI and cleared by
  // the selector on the next model switch.
  const supportsFastSpeed = providerType === 'codex' && codexModelSupportsFastSpeed(model);
  const speed = supportsFastSpeed
    ? resolveCodexSpeedMode(provider)
    : HETEROGENEOUS_AGENT_DEFAULT_SELECTION;
  const isFastSpeed = speed === 'fast';
  const defaultLabel = t('heteroAgent.modelSelector.default');
  const modelLabel = getModelLabel(model, defaultLabel);
  const effortLabelKeys = providerType === 'codex' ? CODEX_EFFORT_LABEL_KEYS : EFFORT_LABEL_KEYS;
  const effortLabel = t(effortLabelKeys[effort]);
  const reasoningLevels =
    providerType === 'codex'
      ? getCodexReasoningEffortLevels(model)
      : CLAUDE_CODE_REASONING_EFFORT_LEVELS;
  const providerModelOptions =
    providerType === 'codex' ? CODEX_MODEL_OPTIONS : CLAUDE_CODE_MODEL_OPTIONS;
  const effortOptions: { label: string; value: HeteroReasoningEffort }[] = [
    { label: defaultLabel, value: HETEROGENEOUS_AGENT_DEFAULT_SELECTION },
    ...reasoningLevels.map((level) => ({
      label: t(effortLabelKeys[level]),
      value: level,
    })),
  ];
  const baseModelOptions: { label: string; value: string }[] = [
    { label: defaultLabel, value: HETEROGENEOUS_AGENT_DEFAULT_SELECTION },
    ...providerModelOptions,
  ];
  const modelOptions = baseModelOptions.some((option) => option.value === model)
    ? baseModelOptions
    : [{ label: model, value: model }, ...baseModelOptions];
  const speedOptions: {
    description: string;
    icon?: typeof ZapIcon;
    label: string;
    value: HeterogeneousSpeedMode;
  }[] = [
    {
      description: t('heteroAgent.modelSelector.speed.standardDesc'),
      label: t('heteroAgent.modelSelector.speed.standard'),
      value: HETEROGENEOUS_AGENT_DEFAULT_SELECTION,
    },
    {
      description: t('heteroAgent.modelSelector.speed.fastDesc'),
      icon: ZapIcon,
      label: t('heteroAgent.modelSelector.speed.fast'),
      value: 'fast',
    },
  ];
  const speedLabel =
    speed === 'fast'
      ? t('heteroAgent.modelSelector.speed.fast')
      : t('heteroAgent.modelSelector.speed.standard');
  const triggerText = getTriggerText({
    defaultConfigLabel: t('heteroAgent.modelSelector.defaultConfig'),
    defaultModelLabel: t('heteroAgent.modelSelector.defaultModel'),
    defaultReasoningLabel: t('heteroAgent.modelSelector.defaultReasoning'),
    effort,
    effortLabel,
    model,
    modelLabel,
  });

  const trigger = (
    <div
      className={cx(styles.trigger, !enabled && styles.triggerDisabled)}
      aria-label={t('heteroAgent.modelSelector.ariaLabel', {
        model: modelLabel,
        reasoning: effortLabel,
      })}
    >
      {isFastSpeed && <Icon icon={ZapIcon} size={12} />}
      <span className={styles.label}>{triggerText}</span>
      <Icon icon={ChevronDownIcon} size={12} />
    </div>
  );

  if (!enabled)
    return (
      <Tooltip
        title={
          !canCreateContent
            ? reason
            : t(isGroupContext ? 'input.viewOnlyGroup' : 'input.viewOnlyAgent')
        }
      >
        <div>{trigger}</div>
      </Tooltip>
    );

  const renderOption = <T extends string>(
    title: string,
    options: readonly { description?: string; icon?: typeof ZapIcon; label: string; value: T }[],
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
        {option.description ? (
          <div className={styles.optionBody}>
            <span className={styles.optionTitle}>
              {option.icon && <Icon className={styles.optionIcon} icon={option.icon} size={14} />}
              {option.label}
            </span>
            <span className={styles.optionDesc}>{option.description}</span>
          </div>
        ) : (
          <span className={styles.optionLabel}>{option.label}</span>
        )}
        {current === option.value && <Icon className={styles.check} icon={CheckIcon} size={16} />}
      </DropdownMenuItem>
    ));

  return (
    <DropdownMenuRoot open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger nativeButton={false}>{trigger}</DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuPositioner placement="topLeft" sideOffset={8}>
          <DropdownMenuPopup className={styles.popup} style={{ width: 240 }}>
            <SelectorSubmenu
              currentValue={modelLabel}
              label={t('heteroAgent.modelSelector.model')}
              popupWidth={240}
            >
              {renderOption('model', modelOptions, model, selectModel)}
            </SelectorSubmenu>
            <SelectorSubmenu
              currentValue={effortLabel}
              label={t('heteroAgent.modelSelector.reasoning')}
            >
              {renderOption('reasoning', effortOptions, effort, selectReasoningEffort)}
            </SelectorSubmenu>
            {supportsFastSpeed && (
              <SelectorSubmenu
                currentValue={speedLabel}
                icon={isFastSpeed ? ZapIcon : undefined}
                label={t('heteroAgent.modelSelector.speed')}
                popupWidth={240}
              >
                {renderOption('speed', speedOptions, speed, selectSpeedMode)}
              </SelectorSubmenu>
            )}
          </DropdownMenuPopup>
        </DropdownMenuPositioner>
      </DropdownMenuPortal>
    </DropdownMenuRoot>
  );
});

HeteroModel.displayName = 'HeteroModel';

export default HeteroModel;
