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
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, ZapIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../hooks/useAgentId';

type HeteroReasoningEffort =
  ClaudeCodeReasoningEffort | CodexReasoningEffort | HeterogeneousAgentDefaultSelection;

type SelectableHeteroProviderType = 'claude-code' | 'codex';

const CLAUDE_CODE_MODEL_OPTIONS = [
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
  submenuLead: css`
    overflow: hidden;
    display: flex;
    gap: 6px;
    align-items: center;

    min-width: 0;
  `,
  submenuMeta: css`
    overflow: hidden;
    min-width: 0;
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
): type is SelectableHeteroProviderType => type === 'claude-code' || type === 'codex';

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
  if (isDefaultModel) return `${defaultModelLabel} · ${effortLabel}`;
  if (isDefaultEffort) return `${modelLabel} · ${defaultReasoningLabel}`;

  return `${modelLabel} · ${effortLabel}`;
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
  const [speedOpen, setSpeedOpen] = useState(false);

  const patchProvider = useCallback(
    async (patch: Partial<Pick<HeterogeneousProviderConfig, 'effort' | 'model' | 'speed'>>) => {
      if (!canCreateContent || !agentId) return;

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
    [agentId, canCreateContent, provider?.args, provider?.type, updateAgentConfigById],
  );
  const closeMenu = useCallback(() => {
    setOpen(false);
    setModelOpen(false);
    setSpeedOpen(false);
  }, []);
  const handleOpenChange = useCallback((value: boolean) => {
    setOpen(value);
    if (!value) {
      setModelOpen(false);
      setSpeedOpen(false);
    }
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
      className={cx(styles.trigger, !canCreateContent && styles.triggerDisabled)}
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

  if (!canCreateContent)
    return (
      <Tooltip title={reason}>
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
    <DropdownMenuRoot open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger nativeButton={false}>{trigger}</DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuPositioner placement="topLeft" sideOffset={8}>
          <DropdownMenuPopup className={styles.popup} style={{ width: 208 }}>
            <div className={styles.sectionTitle}>{t('heteroAgent.modelSelector.reasoning')}</div>
            <div className={styles.scroll}>
              {renderOption('reasoning', effortOptions, effort, selectReasoningEffort)}
            </div>
            <DropdownMenuSeparator className={styles.divider} />
            <DropdownMenuSubmenuRoot open={modelOpen} onOpenChange={setModelOpen}>
              <DropdownMenuSubmenuTrigger
                className={styles.submenuTrigger}
                onClick={(event) => {
                  event.preventDefault();
                  setModelOpen(true);
                }}
                onMouseEnter={() => {
                  setModelOpen(true);
                  setSpeedOpen(false);
                }}
              >
                <span className={styles.submenuLead}>
                  {isFastSpeed && <Icon className={styles.optionIcon} icon={ZapIcon} size={12} />}
                  <span className={styles.submenuMeta}>{modelLabel}</span>
                </span>
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
            {supportsFastSpeed && (
              <DropdownMenuSubmenuRoot open={speedOpen} onOpenChange={setSpeedOpen}>
                <DropdownMenuSubmenuTrigger
                  className={styles.submenuTrigger}
                  onClick={(event) => {
                    event.preventDefault();
                    setSpeedOpen(true);
                  }}
                  onMouseEnter={() => {
                    setSpeedOpen(true);
                    setModelOpen(false);
                  }}
                >
                  <span className={styles.submenuMeta}>{t('heteroAgent.modelSelector.speed')}</span>
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
                    <DropdownMenuPopup className={styles.popup} style={{ minWidth: 232 }}>
                      <div className={styles.sectionTitle}>
                        {t('heteroAgent.modelSelector.speed')}
                      </div>
                      <div className={styles.scroll}>
                        {renderOption('speed', speedOptions, speed, selectSpeedMode)}
                      </div>
                    </DropdownMenuPopup>
                  </DropdownMenuPositioner>
                </DropdownMenuPortal>
              </DropdownMenuSubmenuRoot>
            )}
          </DropdownMenuPopup>
        </DropdownMenuPositioner>
      </DropdownMenuPortal>
    </DropdownMenuRoot>
  );
});

HeteroModel.displayName = 'HeteroModel';

export default HeteroModel;
