'use client';

import type { BuiltinRender, BuiltinRenderProps } from '@lobechat/types';
import type { A2uiActionPayload, A2uiSurfaceState } from '@lobehub/a2ui';
import { SurfaceView, useA2uiHost } from '@lobehub/a2ui/react';
import { memo, useState } from 'react';

import { A2uiApiName, type RenderUIParams, type RenderUIState } from '../../types';

/**
 * The card the Agent drew. An action goes to the conversation's host; once it is accepted the card
 * turns read-only, so one submission can't be sent twice.
 */
export const RenderUIRender = memo<BuiltinRenderProps<RenderUIParams, RenderUIState>>(
  ({ pluginState }) => {
    const host = useA2uiHost();
    const [state, setState] = useState<A2uiSurfaceState>({ status: 'open' });
    const surface = pluginState?.surface;
    if (!surface) return null;

    const onAction =
      host?.canAct && state.status === 'open'
        ? async (action: A2uiActionPayload) => {
            if (await host.sendAction(action, surface))
              setState({ action, status: 'submitted', submittedAt: new Date().toISOString() });
          }
        : undefined;

    return <SurfaceView record={surface} state={state} onAction={onAction} />;
  },
);

RenderUIRender.displayName = 'A2uiRenderUIRender';

export const A2uiRenders: Record<string, BuiltinRender> = {
  [A2uiApiName.renderUI]: RenderUIRender as BuiltinRender,
};
