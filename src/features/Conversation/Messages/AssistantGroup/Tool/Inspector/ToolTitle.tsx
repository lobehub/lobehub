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
}));

interface ToolTitleProps {
  apiName: string;
  args?: Record<string, unknown>;
  identifier: string;
  isAborted?: boolean;
  isLoading?: boolean;
  partialArgs?: Record<string, unknown>;
}

/**
 * Collapsed tool row title: a localized action phrase ("Run command",
 * "Edit file") plus at most one keyword of context (file basename, program,
 * query…). Full arguments stay in the expanded Detail view.
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

    return (
      <div className={cx(styles.root, isAborted && styles.aborted)}>
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
      </div>
    );
  },
);

export default ToolTitle;
