/** @vitest-environment happy-dom */
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { OriginConversationProvider } from '../Conversation/originConversation';
import { useAcceptanceRailState } from './useAcceptanceRailState';

const TopicPanel = () => null;
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(OriginConversationProvider, { TopicPanel, children });

describe('acceptance rail navigation', () => {
  it('never opens a drawer while the responsive breakpoint is resolving', () => {
    const renders: boolean[] = [];
    const { rerender } = renderHook(
      ({ narrow }) => {
        const state = useAcceptanceRailState({ focused: false, isNarrowViewport: narrow });
        renders.push(state.expand);
        return state;
      },
      { initialProps: { narrow: false }, wrapper },
    );

    rerender({ narrow: true });
    // Even a single open frame can leave a modal backdrop after its enter
    // animation is immediately interrupted on mobile.
    expect(renders.every((open) => !open)).toBe(true);
  });

  it('opens on request and closes when entering a focused check', () => {
    const { result, rerender } = renderHook(
      ({ focused }) => useAcceptanceRailState({ focused, isNarrowViewport: true }),
      { initialProps: { focused: false }, wrapper },
    );
    act(() => result.current.onExpandChange(true));
    expect(result.current.expand).toBe(true);
    rerender({ focused: true });
    expect(result.current.expand).toBe(false);
  });

  it('can reopen the source conversation after dismissing its drawer', () => {
    const { result } = renderHook(
      () => useAcceptanceRailState({ focused: false, isNarrowViewport: true }),
      { wrapper },
    );
    act(() => result.current.originConversation?.openTopicDrawer('topic-1'));
    expect(result.current.expand).toBe(true);
    act(() => result.current.onExpandChange(false));
    expect(result.current.expand).toBe(false);
    expect(result.current.originConversation?.isOpen).toBe(false);
    act(() => result.current.originConversation?.openTopicDrawer('topic-1'));
    expect(result.current.expand).toBe(true);
  });
});
