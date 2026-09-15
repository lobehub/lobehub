'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Highlighter } from '@lobehub/ui';
import { memo } from 'react';

import type { BrowserReadPageState, BrowserSnapshotState } from '../../types';

type BrowserPageDumpState = BrowserReadPageState | BrowserSnapshotState;

export const PageDump = memo<BuiltinRenderProps<unknown, BrowserPageDumpState, string>>(
  ({ content, pluginState }) => {
    const pageContent =
      (pluginState && 'snapshot' in pluginState ? pluginState.snapshot : pluginState?.content) ||
      content;
    if (!pageContent) return null;
    return (
      <Highlighter wrap language={'text'} showLanguage={false} style={{ maxHeight: 360 }}>
        {pageContent}
      </Highlighter>
    );
  },
);

PageDump.displayName = 'BrowserPageDump';
