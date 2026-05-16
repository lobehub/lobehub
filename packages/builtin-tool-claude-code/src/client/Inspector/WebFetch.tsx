'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ClaudeCodeApiName, type WebFetchArgs } from '../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 1;
    align-items: center;

    min-width: 0;
    max-width: 60%;
    margin-inline-start: 6px;
    padding-block: 1px;
    padding-inline: 8px;
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
}));

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
      <div className={cx(inspectorTextStyles.root, isShiny && shinyTextStyles.shinyText)}>
        <span>{url ? `${label}:` : label}</span>
        {url && <span className={styles.chip}>{stripProtocol(url)}</span>}
      </div>
    );
  },
);

WebFetchInspector.displayName = 'ClaudeCodeWebFetchInspector';
