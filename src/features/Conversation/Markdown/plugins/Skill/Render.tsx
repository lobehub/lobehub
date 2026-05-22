'use client';

import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { ActionMention } from '@/features/ChatInput/InputEditor/ActionTag/ActionMention';

import { type MarkdownElementProps } from '../type';

interface SkillNodeProps {
  label?: string;
  name?: string;
}

/**
 * Render `<skill name="…" label="…" />` tags that survive in persisted user
 * messages back into the same chip the editor shows during composition. Without
 * this plugin react-markdown leaves the literal tag text in the bubble, which
 * is what users were seeing before.
 *
 * We don't look up the identifier in any registry — the tag already carries
 * both the `name` (runtime identifier) and the human-readable `label`, so the
 * chip just mirrors what was inserted.
 */
const Render = memo<MarkdownElementProps<SkillNodeProps>>(({ node, children }) => {
  const { label, name } = node?.properties || {};
  const displayLabel = label || name || (typeof children === 'string' ? children : undefined);
  if (!displayLabel) return null;
  return <ActionMention category="skill" label={displayLabel} />;
}, isEqual);

Render.displayName = 'SkillRender';

export default Render;
