// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AGENT_SHARE_SETTINGS_WIDTH } from '@/const/layoutTokens';

import AgentShareSkeleton from './AgentShare';

const containerWidths: (number | undefined)[] = [];

vi.mock('@/features/WideScreenContainer', () => ({
  default: ({ children, minWidth }: { children: ReactNode; minWidth?: number }) => {
    containerWidths.push(minWidth);
    return children;
  },
}));

describe('AgentShareSkeleton', () => {
  beforeEach(() => {
    containerWidths.length = 0;
  });

  // The loaded share settings page uses this width on every tab; a skeleton at
  // the default width widened the link card when the page finished loading.
  it('uses the share settings column width', () => {
    const root = createRoot(document.createElement('div'));
    act(() => root.render(createElement(AgentShareSkeleton, { chrome: 'body' })));

    expect(containerWidths.at(-1)).toBe(AGENT_SHARE_SETTINGS_WIDTH);
    act(() => root.unmount());
  });
});
