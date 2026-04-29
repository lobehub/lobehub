'use client';

import type { BuiltinRenderProps, BuiltinStreaming } from '@lobechat/types';
import { createElement, type ReactNode } from 'react';

type AnyRender = (props: BuiltinRenderProps<any, any, any>) => ReactNode;

/**
 * Adapt a result `BuiltinRender` so it can stand in as a `BuiltinStreaming`.
 *
 * Most CC Renders (`Read`, `Write`, `Edit`, `Glob`, `Grep`, `Skill`,
 * `Bash`/`RunCommand`, `TodoWrite`) read `args` for the header/diff/list and
 * gracefully omit the body when `content`/`pluginState` are absent — exactly
 * the streaming-phase shape. Reusing the Render keeps live and final views
 * visually identical and avoids duplicating per-tool layouts.
 */
export const wrapRender = (Render: AnyRender): BuiltinStreaming => {
  const Streaming: BuiltinStreaming = ({ args, messageId, apiName, identifier, toolCallId }) =>
    createElement(Render, { apiName, args, content: null, identifier, messageId, toolCallId });
  return Streaming;
};
