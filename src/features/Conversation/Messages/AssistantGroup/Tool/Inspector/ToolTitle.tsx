import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { ChevronRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { pluginHelpers, useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';
import { shinyTextStyles } from '@/styles';
import { builtinToolIdentifiers } from '@/tools/identifiers';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  aborted: css`
    color: ${cssVar.colorTextQuaternary};
  `,
  root: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    color: ${cssVar.colorTextDescription};
  `,
}));

interface ToolTitleProps {
  apiName: string;
  identifier: string;
  isAborted?: boolean;
  isLoading?: boolean;
}

const ToolTitle = memo<ToolTitleProps>(({ identifier, apiName, isLoading, isAborted }) => {
  const { t } = useTranslation('plugin');

  const pluginMeta = useToolStore(toolSelectors.getMetaById(identifier), isEqual);
  const isBuiltinPlugin = builtinToolIdentifiers.includes(identifier);
  const pluginTitle = pluginHelpers.getPluginTitle(pluginMeta) ?? t('unknownPlugin');

  return (
    <div
      className={cx(
        styles.root,
        isLoading && shinyTextStyles.shinyText,
        isAborted && styles.aborted,
      )}
    >
      <span>
        {isBuiltinPlugin
          ? t(`builtins.${identifier}.title`, {
              defaultValue: identifier,
            })
          : pluginTitle}
      </span>
      <Icon icon={ChevronRight} style={{ marginInline: 4 }} />
      <span>
        {isBuiltinPlugin
          ? t(`builtins.${identifier}.apiName.${apiName}`, {
              defaultValue: apiName,
            })
          : apiName}
      </span>
    </div>
  );
});

export default ToolTitle;
