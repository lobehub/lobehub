'use client';

import { useEditor } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import CollapsibleContent from '@/components/CollapsibleContent';
import { EditorCanvas } from '@/features/EditorCanvas';
import { usePermission } from '@/hooks/usePermission';
import { useGoalStore } from '@/store/goal';

/**
 * "What counts as done" as a live document, in the TaskInstruction shape: an
 * always-mounted editor that clamps when long and autosaves on a debounce.
 * Goals carry no collaborative lock and persist markdown only, so this is the
 * instruction pattern minus the lock/attachment machinery.
 */

const REQUIREMENT_MAX_HEIGHT = 320;
const SAVE_DEBOUNCE_MS = 600;

interface GoalRequirementProps {
  goalId: string;
  requirement: string;
}

const GoalRequirement = memo<GoalRequirementProps>(({ goalId, requirement }) => {
  const { t } = useTranslation('chat');
  const { allowed: canEdit } = usePermission('create_content');
  const updateGoalRequirement = useGoalStore((s) => s.updateGoalRequirement);
  const editor = useEditor();

  const [expanded, setExpanded] = useState(false);

  // The graph polls while the goal runs; reloading the mounted editor from
  // every snapshot would eat live input. Freeze the document at the first
  // value seen per goal — the editor itself is the source of truth afterwards.
  const initialRef = useRef({ goalId, requirement });
  if (initialRef.current.goalId !== goalId) {
    initialRef.current = { goalId, requirement };
    setExpanded(false);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const editorData = useMemo(() => ({ content: initialRef.current.requirement }), [goalId]);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastSavedRef = useRef(requirement);
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const handleContentChange = useCallback(() => {
    if (!canEdit || !editor) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = undefined;
      const markdown = String(editor.getDocument('markdown') ?? '').trim();
      // An emptied requirement is far more likely a half-finished edit than an
      // intent to drop the acceptance bar; keep the last saved text until the
      // user writes a replacement.
      if (!markdown || markdown === lastSavedRef.current) return;
      lastSavedRef.current = markdown;
      updateGoalRequirement(goalId, markdown).catch((error) => {
        console.error('[GoalRequirement] Failed to save:', error);
      });
    }, SAVE_DEBOUNCE_MS);
  }, [canEdit, editor, goalId, updateGoalRequirement]);

  // One click both expands the clamped text and lands the caret where it aimed.
  const handleFocus = useCallback(() => setExpanded(true), []);

  const handleCollapsedChange = useCallback(
    (collapsed: boolean) => {
      // Collapsing while the editor holds the caret would let Lexical restore
      // focus and immediately re-expand.
      if (collapsed) editor?.blur();
      setExpanded(!collapsed);
    },
    [editor],
  );

  return (
    <Flexbox gap={4} paddingBlock={'8px 0'}>
      <Text fontSize={12} type={'secondary'} weight={500}>
        {t('goalProcess.requirement')}
      </Text>
      <CollapsibleContent
        collapsed={!expanded}
        maxHeight={REQUIREMENT_MAX_HEIGHT}
        onCollapsedChange={handleCollapsedChange}
      >
        <div onFocus={handleFocus}>
          <EditorCanvas
            disabled={!canEdit}
            editor={editor}
            editorData={editorData}
            entityId={goalId}
            placeholder={t('goalProcess.requirementPlaceholder')}
            style={{ fontSize: 14 }}
            onContentChange={handleContentChange}
          />
        </div>
      </CollapsibleContent>
    </Flexbox>
  );
});

GoalRequirement.displayName = 'GoalRequirement';

export default GoalRequirement;
