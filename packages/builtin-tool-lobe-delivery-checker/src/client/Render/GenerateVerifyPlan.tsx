'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { ActionIcon, Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import { Bot, Scale, SlidersHorizontal, SquareTerminal } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

import type {
  GeneratedVerifyCheck,
  GenerateVerifyPlanParams,
  GenerateVerifyPlanState,
  VerifyVerifierType,
} from '../../types';
import { LobeDeliveryCheckerIdentifier } from '../../types';

/** Verifier-type icon, matching the config panel: agent → bot, llm → scale. */
const VERIFIER_ICON: Record<VerifyVerifierType, LucideIcon> = {
  agent: Bot,
  llm: Scale,
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
  card: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;
    background: ${cssVar.colorBgElevated};
  `,
  kicker: css`
    font-size: 12px;
    font-weight: 600;
    color: ${cssVar.colorTextTertiary};
  `,
  row: css`
    cursor: pointer;
    padding-block: 10px;
    padding-inline: 12px;
    transition: background 150ms ${cssVar.motionEaseOut};

    &:not(:last-child) {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    }

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  tag: css`
    flex: none;

    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 6px;

    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorFillTertiary};
  `,
  tagRequired: css`
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};
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
  const rubricId = pluginState?.rubricId;

  if (!items.length) return null;

  return (
    <Flexbox gap={8} paddingBlock={4}>
      {(title || rubricId) && (
        <Flexbox horizontal align="center" gap={8} justify="space-between">
          {title ? <span className={styles.kicker}>{title}</span> : <span />}
          {rubricId && (
            <ActionIcon
              icon={SlidersHorizontal}
              size="small"
              title={t('builtins.lobe-delivery-checker.verifyPlan.portal.rubric.title')}
              onClick={() =>
                openToolUI(messageId, LobeDeliveryCheckerIdentifier, { view: 'rubric' })
              }
            />
          )}
        </Flexbox>
      )}
      <div className={styles.card}>
        {items.map((item, index) => (
          <Flexbox
            horizontal
            align="flex-start"
            className={styles.row}
            gap={8}
            justify="space-between"
            key={index}
            onClick={() => openToolUI(messageId, LobeDeliveryCheckerIdentifier, { index })}
          >
            <Flexbox horizontal align="flex-start" gap={8} style={{ minWidth: 0 }}>
              <Icon
                className={styles.icon}
                icon={VERIFIER_ICON[item.verifierType] ?? Scale}
                size={15}
              />
              <Flexbox gap={0} style={{ minWidth: 0 }}>
                <span className={styles.title}>{item.title}</span>
                {item.description && <span className={styles.description}>{item.description}</span>}
              </Flexbox>
            </Flexbox>
            <span className={`${styles.tag} ${item.required ? styles.tagRequired : ''}`}>
              {item.required
                ? t('builtins.lobe-delivery-checker.verifyPlan.required')
                : t('builtins.lobe-delivery-checker.verifyPlan.optional')}
            </span>
          </Flexbox>
        ))}
      </div>
    </Flexbox>
  );
});

GenerateVerifyPlanRender.displayName = 'GenerateVerifyPlanRender';

export default GenerateVerifyPlanRender;
