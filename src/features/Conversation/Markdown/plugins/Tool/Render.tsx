'use client';

import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { ActionMention } from '@/features/ChatInput/InputEditor/ActionTag/ActionMention';

import { type MarkdownElementProps } from '../type';

interface ToolNodeProps {
  label?: string;
  name?: string;
}

/**
 * Counterpart to the Skill plugin for `<tool name="…" label="…" />` tags —
 * see `../Skill/Render.tsx` for the rationale.
 */
const Render = memo<MarkdownElementProps<ToolNodeProps>>(({ node, children }) => {
  const { label, name } = node?.properties || {};
  const displayLabel = label || name || (typeof children === 'string' ? children : undefined);
  if (!displayLabel) return null;
  return <ActionMention category="tool" label={displayLabel} />;
}, isEqual);

Render.displayName = 'ToolRender';

export default Render;
