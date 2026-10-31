'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Avatar, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { InstallMarketplaceAgentSummary } from '../../../pickResult';
import type { SubmitAgentPickArgs } from '../../../types';

interface SubmitAgentPickState {
  installedAgentIds?: string[];
  selectedAgentIds?: string[];
  skippedAgentIds?: string[];
  summaries?: InstallMarketplaceAgentSummary[];
}

const styles = stylex.create({
  card: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    padding: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorFillSecondary,
    borderRadius: cssVar.borderRadiusLG,
    background: cssVar.colorBgElevated,
  },
  cardSkipped: { opacity: 0.65 },
  description: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '2',
    fontSize: '12px',
    lineHeight: 1.5,
    color: cssVar.colorTextSecondary,
  },
  list: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: '8px',
    width: '100%',
  },
  skippedTag: {
    flexShrink: 0,
    marginInlineStart: '4px',
    paddingBlock: '1px',
    paddingInline: '6px',
    borderRadius: '999px',
    fontSize: '11px',
    color: cssVar.colorTextTertiary,
    background: cssVar.colorFillTertiary,
  },
  title: {
    overflow: 'hidden',
    flex: '1',
    minWidth: '0',
    fontSize: '14px',
    fontWeight: 600,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  titleRow: { display: 'flex', gap: '6px', alignItems: 'center', width: '100%' },
});

export type SubmitAgentPickRenderProps = Pick<
  BuiltinRenderProps<SubmitAgentPickArgs, SubmitAgentPickState>,
  'pluginState'
>;

const SubmitAgentPick = memo<SubmitAgentPickRenderProps>(({ pluginState }) => {
  const { t } = useTranslation('tool');
  const summaries = pluginState?.summaries ?? [];

  if (summaries.length === 0) return null;

  const installedCount = summaries.filter((s) => !s.skipped).length;
  const skippedCount = summaries.length - installedCount;

  return (
    <Flexbox gap={12}>
      <Text style={{ fontSize: 13 }} type="secondary">
        {t('agentMarketplace.inspector.pickCount', { count: installedCount })}
        {skippedCount > 0 &&
          ` · ${t('agentMarketplace.render.alreadyInLibrary', { count: skippedCount })}`}
      </Text>
      <div {...stylex.props(styles.list)}>
        {summaries.map((summary) => (
          <div
            {...stylex.props(styles.card, summary.skipped && styles.cardSkipped)}
            key={summary.templateId}
          >
            <Avatar avatar={summary.avatar || '🤖'} shape="square" size={36} />
            <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
              <div {...stylex.props(styles.titleRow)}>
                <span {...stylex.props(styles.title)}>{summary.title || summary.templateId}</span>
                {summary.skipped && (
                  <span {...stylex.props(styles.skippedTag)}>
                    {t('agentMarketplace.render.alreadyInLibraryTag')}
                  </span>
                )}
              </div>
              {summary.description && (
                <div {...stylex.props(styles.description)}>{summary.description}</div>
              )}
            </Flexbox>
          </div>
        ))}
      </div>
    </Flexbox>
  );
});

SubmitAgentPick.displayName = 'SubmitAgentPick';

export default SubmitAgentPick;
