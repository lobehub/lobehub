'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import { Bot, Sparkles, SquareTerminal } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

import type {
  GeneratedVerifyCheck,
  GenerateVerifyPlanParams,
  GenerateVerifyPlanState,
  VerifyVerifierType,
} from '../../types';
import { LobeAgentIdentifier } from '../../types';

/** Each verifier type gets a distinct icon so llm/agent/program checks read apart. */
const VERIFIER_ICON: Record<VerifyVerifierType, LucideIcon> = {
  agent: Bot,
  llm: Sparkles,
  program: SquareTerminal,
};

const styles = createStaticStyles(({ css, cssVar }) => ({
  icon: css`
    margin-block-start: 1px;
    color: ${cssVar.colorTextSecondary};
  `,
  description: css`
    margin-block-start: 2px;
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextTertiary};
  `,
  item: css`
    cursor: pointer;

    padding-block: 8px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    transition:
      border-color 150ms ${cssVar.motionEaseOut},
      background 150ms ${cssVar.motionEaseOut};

    &:hover {
      border-color: ${cssVar.colorBorder};
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  kicker: css`
    font-size: 12px;
    font-weight: 600;
    color: ${cssVar.colorTextTertiary};
  `,
  tag: css`
    flex: none;

    padding-block: 1px;
    padding-inline: 6px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 4px;

    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
  `,
  tagRequired: css`
    border-color: ${cssVar.colorBorder};
    color: ${cssVar.colorText};
  `,
  title: css`
    font-weight: 500;
    line-height: 1.5;
    color: ${cssVar.colorText};
  `,
}));

/**
 * Renders the `generateVerifyPlan` tool call: the delivery standard title plus
 * the checks the deliverable must satisfy. Each row shows a verifier-type icon,
 * the check title, its judging instruction, and a required/optional tag. Reads
 * the created plan from `pluginState` once executed, and falls back to the
 * proposed `args` while the call awaits confirmation.
 */
const GenerateVerifyPlanRender = memo<
  BuiltinRenderProps<GenerateVerifyPlanParams, GenerateVerifyPlanState>
>(({ args, pluginState, messageId }) => {
  const { t } = useTranslation('plugin');
  const openToolUI = useChatStore((s) => s.openToolUI);

  const items: GeneratedVerifyCheck[] =
    pluginState?.items ??
    (args?.criteria ?? []).map((c) => ({
      description: c.description,
      onFail: c.onFail ?? 'manual',
      required: c.required ?? true,
      title: c.title,
      verifierType: c.verifierType ?? 'llm',
    }));
  const title = pluginState?.title ?? args?.title;

  if (!items.length) return null;

  return (
    <Flexbox gap={6} paddingBlock={4}>
      {title && <span className={styles.kicker}>{title}</span>}
      {items.map((item, index) => (
        <Flexbox
          horizontal
          align="flex-start"
          className={styles.item}
          gap={8}
          justify="space-between"
          key={index}
          onClick={() => openToolUI(messageId, LobeAgentIdentifier, { index })}
        >
          <Flexbox horizontal align="flex-start" gap={8} style={{ minWidth: 0 }}>
            <Icon
              className={styles.icon}
              icon={VERIFIER_ICON[item.verifierType] ?? Sparkles}
              size={15}
            />
            <Flexbox gap={0} style={{ minWidth: 0 }}>
              <span className={styles.title}>{item.title}</span>
              {item.description && <span className={styles.description}>{item.description}</span>}
            </Flexbox>
          </Flexbox>
          <span className={`${styles.tag} ${item.required ? styles.tagRequired : ''}`}>
            {item.required
              ? t('builtins.lobe-agent.verifyPlan.required')
              : t('builtins.lobe-agent.verifyPlan.optional')}
          </span>
        </Flexbox>
      ))}
    </Flexbox>
  );
});

GenerateVerifyPlanRender.displayName = 'GenerateVerifyPlanRender';

export default GenerateVerifyPlanRender;
