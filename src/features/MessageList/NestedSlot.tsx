'use client';

import * as stylex from '@stylexjs/stylex';
import { memo, type PropsWithChildren, useSyncExternalStore } from 'react';

import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';
import {
  getNavPanelRegistrySnapshot,
  subscribeNavPanelRegistry,
} from '@/features/NavPanel/registry';

import { styles } from './style';

/**
 * Registry key for the content nested under the active conversation (its topic
 * list). The agent and group route layouts own that content, so they register
 * it here instead of painting a separate sidebar.
 */
export const CONVERSATION_NESTED_KEY = 'messages:nested';

export const ConversationNestedPortal = memo<PropsWithChildren>(({ children }) => (
  <NavPanelPortal navKey={CONVERSATION_NESTED_KEY}>{children}</NavPanelPortal>
));

ConversationNestedPortal.displayName = 'ConversationNestedPortal';

const getNested = () => getNavPanelRegistrySnapshot().get(CONVERSATION_NESTED_KEY)?.node;

const NestedSlot = memo(() => {
  const node = useSyncExternalStore(subscribeNavPanelRegistry, getNested, getNested);
  if (!node) return null;

  return <div {...stylex.props(styles.nested)}>{node}</div>;
});

NestedSlot.displayName = 'NestedSlot';

export default NestedSlot;
