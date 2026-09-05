import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { ChevronRight } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { pluginHelpers, useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';
import { shinyTextStyles } from '@/styles';

import { getToolDisplayName } from '../../toolDisplayNames';
import { extractToolKeyword } from './extractToolKeyword';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  aborted: css`
    color: ${cssVar.colorTextQuaternary};
  `,
  keyword: css`
    overflow: hidden;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
  `,
  root: css`
    overflow: hidden;
    display: flex;
    gap: 6px;
    align-items: center;

    min-width: 0;
    padding-block: 1px;

    color: ${cssVar.colorTextDescription};
    white-space: nowrap;
  `,
  standalone: css`
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
  `,
}));

interface ToolTitleProps {
  apiName: string;
  args?: Record<string, unknown>;
  identifier: string;
  isAborted?: boolean;
  isLoading?: boolean;
  partialArgs?: Record<string, unknown>;
}

const isCJK = (value: string) => /[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(value);

/**
 * Collapsed tool row title. When the model wrote a step description it stands
 * alone — the action label ("执行代码") adds nothing next to "恢复登录态", and
 * showing both at different sizes reads as a glitch, so the description takes
 * the label's typography. Command-like keywords (program name, file basename)
 * keep the "<label> <keyword>" shape in the smaller code font.
 */
const ToolTitle = memo<ToolTitleProps>(
  ({ identifier, apiName, args, partialArgs, isLoading, isAborted }) => {
    const { t } = useTranslation('plugin');

    const pluginMeta = useToolStore(toolSelectors.getMetaById(identifier), isEqual);
    const pluginTitle = pluginHelpers.getPluginTitle(pluginMeta);

    // Builtin (and hetero-agent) tools have per-API action labels under
    // `builtins.<identifier>.apiName.<apiName>`; everything else falls back to
    // the workflow-summary display name (MCP short labels / title-cased
    // apiName), prefixed with the plugin title when we actually know it.
    const actionLabel = t(`builtins.${identifier}.apiName.${apiName}`, { defaultValue: '' });

    const keyword = useMemo(() => extractToolKeyword(args ?? partialArgs), [args, partialArgs]);

    // A model-written description states the whole step on its own; pairing it
    // with the action label duplicates meaning ("执行代码 查看当前运行中的
    // Docker 容器") at mismatched font sizes. Let it replace the label and
    // inherit the label's typography instead of the small code font.
    const isStandaloneDescription = !!keyword && isCJK(keyword);

    return (
      <div className={cx(styles.root, isAborted && styles.aborted)}>
        {isStandaloneDescription ? (
          <span className={cx(styles.standalone, isLoading && shinyTextStyles.shinyText)}>
            {keyword}
          </span>
        ) : (
          <>
            <span className={cx(isLoading && shinyTextStyles.shinyText)}>
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
            {keyword && <span className={styles.keyword}>{keyword}</span>}
          </>
        )}
      </div>
    );
  },
);

export default ToolTitle;
