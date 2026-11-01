import { getGoalCommand, isGoalCommandFailed } from '@lobechat/shared-tool-ui/goal-command';
import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { ChevronRight } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { pluginHelpers, useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';
import { shinyTextStyles } from '@/styles';
import { sx } from '@/styles/sx';

import { getToolDisplayName } from '../../toolDisplayNames';
import { extractToolKeyword } from './extractToolKeyword';

export const styles = stylex.create({
  aborted: { color: cssVar.colorTextQuaternary },
  keyword: {
    overflow: 'hidden',
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: 'auto',
    minWidth: '0',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
  },
  root: {
    overflow: 'hidden',
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    minWidth: '0',
    paddingBlock: '1px',
    color: cssVar.colorTextDescription,
    whiteSpace: 'nowrap',
  },
  label: { flex: 'none' },
  standalone: {
    overflow: 'hidden',
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: 'auto',
    minWidth: '0',
    textOverflow: 'ellipsis',
  },
});

interface ToolTitleProps {
  apiName: string;
  args?: Record<string, unknown>;
  identifier: string;
  isAborted?: boolean;
  isLoading?: boolean;
  partialArgs?: Record<string, unknown>;
  /** The settled tool result, so a failed goal command is not titled as done. */
  result?: { error?: unknown; state?: any };
}

const isCJK = (value: string) => /[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(value);

/**
 * Collapsed tool row title. When a command has a step description it stands
 * alone — the action label ("执行代码") adds nothing next to "恢复登录态", and
 * showing both at different sizes reads as a glitch, so the description takes
 * the label's typography. Command-like keywords (program name, file basename)
 * keep the "<label> <keyword>" shape in the smaller code font.
 */
const ToolTitle = memo<ToolTitleProps>(
  ({ identifier, apiName, args, partialArgs, isLoading, isAborted, result }) => {
    const { t } = useTranslation('plugin');

    const pluginMeta = useToolStore(toolSelectors.getMetaById(identifier), isEqual);
    const pluginTitle = pluginHelpers.getPluginTitle(pluginMeta);

    // Builtin (and hetero-agent) tools have per-API action labels under
    // `builtins.<identifier>.apiName.<apiName>`; everything else falls back to
    // the workflow-summary display name (MCP short labels / title-cased
    // apiName), prefixed with the plugin title when we actually know it.
    const actionLabel = t(`builtins.${identifier}.apiName.${apiName}`, { defaultValue: '' });

    const effectiveArgs = args ?? partialArgs;
    const keyword = useMemo(() => extractToolKeyword(effectiveArgs), [effectiveArgs]);

    // Only command step descriptions can replace the action. Resource titles,
    // queries, and paths can also contain CJK text but do not say what the tool
    // is doing (for example, creating versus updating a Linear issue).
    const hasCommand = ['command', 'cmd', 'script'].some(
      (key) => typeof effectiveArgs?.[key] === 'string' && effectiveArgs[key].trim(),
    );
    const isStandaloneDescription =
      hasCommand &&
      !!keyword &&
      isCJK(keyword) &&
      keyword === extractToolKeyword({ description: effectiveArgs?.description });

    // `/goal` in a CLI agent conversation creates and plans the goal through
    // `lh` — that step reads as the goal step, not "执行命令 <description>".
    const goalCommand = useMemo(
      () =>
        typeof effectiveArgs?.command === 'string'
          ? getGoalCommand(effectiveArgs.command)
          : undefined,
      [effectiveArgs],
    );
    if (goalCommand) {
      const goalTitle = goalCommand.kind === 'create' ? goalCommand.title : undefined;
      // Same rule as the expanded GoalCommandInspector, so the collapsed row
      // never says "Goal created" next to a failed status.
      const failed = !isLoading && isGoalCommandFailed(result);
      const status = isLoading ? 'loading' : failed ? 'failed' : 'completed';
      return (
        <div {...stylex.props(styles.root, isAborted && styles.aborted)}>
          <span {...sx([styles.label], isLoading ? shinyTextStyles.shinyText : undefined)}>
            {t(`builtins.goalCommand.${goalCommand.kind}.${status}`)}
          </span>
          {goalTitle && <span {...stylex.props(styles.standalone)}>{goalTitle}</span>}
        </div>
      );
    }

    return (
      <div {...stylex.props(styles.root, isAborted && styles.aborted)}>
        {isStandaloneDescription ? (
          <span {...sx([styles.standalone], isLoading ? shinyTextStyles.shinyText : undefined)}>
            {keyword}
          </span>
        ) : (
          <>
            <span {...sx([styles.label], isLoading ? shinyTextStyles.shinyText : undefined)}>
              {actionLabel || (
                <>
                  {pluginTitle && (
                    <>
                      <span>{pluginTitle}</span>
                      <Icon icon={ChevronRight} />
                    </>
                  )}
                  <span>{getToolDisplayName(apiName)}</span>
                </>
              )}
            </span>
            {keyword && <span {...stylex.props(styles.keyword)}>{keyword}</span>}
          </>
        )}
      </div>
    );
  },
);

export default ToolTitle;
