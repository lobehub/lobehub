'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Alert, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatArgumentEntries } from '@/features/Automations/formatArguments';

import type { SubscribeEventArgs } from '../../types';
import ConnectorEventLabel from '../components/ConnectorEventLabel';

const styles = stylex.create({
  argKey: { flex: 'none', fontFamily: cssVar.fontFamilyCode, color: cssVar.colorTextSecondary },
  argValue: {
    minInlineSize: 0,
    fontFamily: cssVar.fontFamilyCode,
    color: cssVar.colorText,
    overflowWrap: 'anywhere',
  },
  args: { minInlineSize: 0, fontSize: '12px', lineHeight: 1.6 },
  instructions: {
    overflowY: 'auto',
    maxBlockSize: '200px',
    fontSize: '13px',
    lineHeight: 1.6,
    color: cssVar.colorText,
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  },
  label: {
    flex: 'none',
    inlineSize: '88px',
    fontSize: '12px',
    lineHeight: 1.6,
    color: cssVar.colorTextTertiary,
  },
  root: { paddingBlock: '4px' },
  row: {
    paddingBlock: '8px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
});

/**
 * Approval for a standing trigger, not a one-off call. In the order the
 * decision needs it: where events come from, which of them (the filter),
 * what the agent will do each time, and what that costs — every event runs
 * the agent and uses credits until the user deletes the subscription. The
 * card is read-only: to change the filter or the instruction, reject and say
 * so in the conversation.
 */
const SubscribeEventIntervention = memo<BuiltinInterventionProps<SubscribeEventArgs>>(
  ({ args }) => {
    const { t } = useTranslation('plugin');
    const entries = formatArgumentEntries(args?.arguments);
    const instructions = args?.instructions?.trim();

    return (
      <Flexbox gap={4} {...stylex.props(styles.root)}>
        <Flexbox paddingBlock={'0 8px'}>
          <ConnectorEventLabel event={args?.name} identifier={args?.connector ?? ''} size={20} />
        </Flexbox>

        <Flexbox horizontal gap={12} {...stylex.props(styles.row)}>
          <span {...stylex.props(styles.label)}>
            {t('builtins.lobe-mcp-events.intervention.filter')}
          </span>
          {entries.length > 0 ? (
            <Flexbox gap={2} {...stylex.props(styles.args)}>
              {entries.map((entry) => (
                <Flexbox horizontal gap={8} key={entry.key}>
                  <span {...stylex.props(styles.argKey)}>{entry.key}</span>
                  <span {...stylex.props(styles.argValue)}>{entry.value}</span>
                </Flexbox>
              ))}
            </Flexbox>
          ) : (
            <Text style={{ fontSize: 12, lineHeight: 1.6 }}>
              {t('builtins.lobe-mcp-events.render.noFilter', { event: args?.name ?? '' })}
            </Text>
          )}
        </Flexbox>

        <Flexbox horizontal gap={12} {...stylex.props(styles.row)}>
          <span {...stylex.props(styles.label)}>
            {t('builtins.lobe-mcp-events.intervention.instructions')}
          </span>
          {instructions ? (
            <div {...stylex.props(styles.instructions)}>{instructions}</div>
          ) : (
            <Text style={{ fontSize: 12, lineHeight: 1.6 }} type={'secondary'}>
              --
            </Text>
          )}
        </Flexbox>

        <Alert
          showIcon
          description={t('builtins.lobe-mcp-events.intervention.costDesc')}
          title={t('builtins.lobe-mcp-events.intervention.costTitle')}
          type={'info'}
          variant={'borderless'}
        />
      </Flexbox>
    );
  },
);

SubscribeEventIntervention.displayName = 'McpEventsSubscribeEventIntervention';

export default SubscribeEventIntervention;
