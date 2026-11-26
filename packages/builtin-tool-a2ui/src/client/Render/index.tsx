'use client';

import type { BuiltinRender, BuiltinRenderProps } from '@lobechat/types';
import { HostedSurface } from '@lobehub/a2ui/react';
import { memo } from 'react';

import { A2uiApiName, type RenderUIParams, type RenderUIState } from '../../types';

/** The card the Agent drew, wired to the conversation's A2UI host. */
export const RenderUIRender = memo<BuiltinRenderProps<RenderUIParams, RenderUIState>>(
  ({ pluginState }) =>
    pluginState?.surface ? <HostedSurface record={pluginState.surface} /> : null,
);

RenderUIRender.displayName = 'A2uiRenderUIRender';

export const A2uiRenders: Record<string, BuiltinRender> = {
  [A2uiApiName.renderUI]: RenderUIRender as BuiltinRender,
};
