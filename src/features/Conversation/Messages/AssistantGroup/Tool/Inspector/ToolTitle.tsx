import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { ChevronRight } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { pluginHelpers, useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';
import { shinyTextStyles } from '@/styles';
import { builtinToolIdentifiers } from '@/tools/identifiers';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  aborted: css`
    color: ${cssVar.colorTextQuaternary};
  `,
  apiName: css`
    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorTextSecondary};
  `,
  paramKey: css`
    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorTextTertiary};
  `,
  paramValue: css`
    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorTextSecondary};
  `,
  root: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    color: ${cssVar.colorTextDescription};
  `,
}));

// Maximum number of parameters to display
const MAX_PARAMS = 1;
// Maximum length for parameter values before truncation
const MAX_VALUE_LENGTH = 50;

const truncateValue = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength) + '...';
};

const formatParamValue = (value: unknown): string => {
  if (typeof value === 'string') {
    return truncateValue(value, MAX_VALUE_LENGTH);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return truncateValue(JSON.stringify(value), MAX_VALUE_LENGTH);
  }
  if (typeof value === 'object' && value !== null) {
    return truncateValue(JSON.stringify(value), MAX_VALUE_LENGTH);
  }
  return String(value);
};

interface ToolTitleProps {
  apiName: string;
  args?: Record<string, unknown>;
  identifier: string;
  isAborted?: boolean;
  isLoading?: boolean;
  partialArgs?: Record<string, unknown>;
}

const ToolTitle = memo<ToolTitleProps>(
  ({ identifier, apiName, args, partialArgs, isLoading, isAborted }) => {
    const { t } = useTranslation('plugin');

    const pluginMeta = useToolStore(toolSelectors.getMetaById(identifier), isEqual);
    const isBuiltinPlugin = builtinToolIdentifiers.includes(identifier);
    const pluginTitle = pluginHelpers.getPluginTitle(pluginMeta) ?? t('unknownPlugin');

    const params = useMemo(() => {
      const argsToUse = args || partialArgs || {};
      return Object.entries(argsToUse).slice(0, MAX_PARAMS);
    }, [args, partialArgs]);

    const remainingCount = useMemo(() => {
      const argsToUse = args || partialArgs || {};
      const total = Object.keys(argsToUse).length;
      return total > MAX_PARAMS ? total - MAX_PARAMS : 0;
    }, [args, partialArgs]);

    const moreParamsText = useMemo(() => {
      if (remainingCount === 0) return '';
      return ' ' + t('arguments.moreParams', { count: remainingCount + params.length });
    }, [params.length, remainingCount, t]);

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
            ? t(`builtins.${identifier}.title`, { defaultValue: identifier })
            : pluginTitle}
        </span>
        <Icon icon={ChevronRight} style={{ marginInline: 4 }} />
        <span className={styles.apiName}>
          {isBuiltinPlugin
            ? t(`builtins.${identifier}.apiName.${apiName}`, { defaultValue: apiName })
            : apiName}
        </span>
        {params.length > 0 && (
          <>
            <span className={styles.paramKey}>{' ('}</span>
            {params.map(([key, value], index) => (
              <span key={key}>
                <span className={styles.paramKey}>{key}: </span>
                <span className={styles.paramValue}>{formatParamValue(value)}</span>
                {index < params.length - 1 && <span className={styles.paramKey}>, </span>}
              </span>
            ))}
            {moreParamsText && <span className={styles.paramKey}>{moreParamsText}</span>}
            <span className={styles.paramKey}>{')'}</span>
          </>
        )}
      </div>
    );
  },
);

export default ToolTitle;
