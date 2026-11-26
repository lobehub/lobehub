'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Markdown } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import ProposedPlanDecision from './ProposedPlanDecision';

/** Plugin state of a `proposed_plan` tool message (see `codexPlanMode` in heterogeneous-agents). */
export interface CodexProposedPlanState {
  plan?: { completed?: boolean; text?: string };
}

const styles = stylex.create({
  plan: {
    paddingBlock: '4px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
  },
});

/**
 * A plan Codex proposed in plan mode. `item/plan/delta` streams the text; the
 * completed plan item (the tool result) is the plan of record. The latest
 * plan offers to carry it out or keep discussing.
 */
const ProposedPlanRender = memo<BuiltinRenderProps<unknown, CodexProposedPlanState, string>>(
  ({ content, messageId, pluginState, toolCallId }) => {
    const completed = pluginState?.plan?.completed === true || !!content;
    const text = (completed && content) || pluginState?.plan?.text || '';
    if (!text) return null;

    return (
      <>
        <div data-testid={'codex-proposed-plan'} {...stylex.props(styles.plan)}>
          <Markdown animated={!completed} variant={'chat'}>
            {text}
          </Markdown>
        </div>
        {completed && <ProposedPlanDecision messageId={messageId} toolCallId={toolCallId} />}
      </>
    );
  },
);

ProposedPlanRender.displayName = 'CodexProposedPlanRender';

export default ProposedPlanRender;
