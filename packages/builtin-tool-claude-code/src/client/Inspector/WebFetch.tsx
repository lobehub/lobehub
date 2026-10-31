'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Globe } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ClaudeCodeApiName, type WebFetchArgs } from '../../types';

const styles = stylex.create({
  chip: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 1,
    gap: '6px',
    alignItems: 'center',
    minWidth: '0',
    marginInlineStart: '6px',
    paddingBlock: '2px',
    paddingInline: '10px',
    borderRadius: '999px',
    background: cssVar.colorFillTertiary,
  },
  icon: { flexShrink: 0, color: cssVar.colorTextDescription },
  url: {
    overflow: 'hidden',
    minWidth: '0',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

/**
 * Strip the protocol so the chip leads with the host — full URLs eat the
 * width quickly and the `https://` prefix is noise.
 */
const stripProtocol = (url: string): string => url.replace(/^https?:\/\//i, '');

export const WebFetchInspector = memo<BuiltinInspectorProps<WebFetchArgs>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');
    const label = t(ClaudeCodeApiName.WebFetch as any);
    const url = (args?.url || partialArgs?.url || '').trim();

    if (isArgumentsStreaming && !url) {
      return <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>{label}</div>;
    }

    const isShiny = isArgumentsStreaming || isLoading;

    return (
      <div className={inspectorTextStyles.root}>
        <span className={cx(isShiny && shinyTextStyles.shinyText)}>
          {url ? `${label}:` : label}
        </span>
        {url && (
          <span {...stylex.props(styles.chip)}>
            <Globe className={stylex.props(styles.icon).className} size={14} />
            <span {...stylex.props(styles.url)}>{stripProtocol(url)}</span>
          </span>
        )}
      </div>
    );
  },
);

WebFetchInspector.displayName = 'ClaudeCodeWebFetchInspector';
