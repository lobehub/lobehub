'use client';

import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { ActionMention } from '@/features/ChatInput/InputEditor/ActionTag/ActionMention';
import { useProjectSkillResolver } from '@/features/SkillsList/useProjectSkillResolver';
import { useAgentStore } from '@/store/agent';

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
 * The persisted wire format carries no category, so we resolve the `name`
 * against the active session's project skills: a match renders as a clickable
 * "project skill" chip (own description + opens SKILL.md), otherwise it degrades
 * to a plain, non-clickable skill chip.
 */
const Render = memo<MarkdownElementProps<SkillNodeProps>>(({ node, children }) => {
  const { label, name } = node?.properties || {};
  const displayLabel = label || name || (typeof children === 'string' ? children : undefined);

  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const resolveProjectSkill = useProjectSkillResolver(activeAgentId);
  // The runtime identifier is the `name`; fall back to the displayed text.
  const skillName = name || (typeof displayLabel === 'string' ? displayLabel : undefined);
  const skill = skillName ? resolveProjectSkill(skillName) : undefined;

  if (!displayLabel) return null;
  return (
    <ActionMention
      category={skill ? 'projectSkill' : 'skill'}
      description={skill?.description}
      label={displayLabel}
      onClick={skill?.open}
    />
  );
}, isEqual);

Render.displayName = 'SkillRender';

export default Render;
