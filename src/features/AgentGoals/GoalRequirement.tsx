'use client';

import { useEditor } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { toast } from '@lobehub/ui/base-ui';
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

  const saveNow = useCallback(() => {
    if (!canEdit || !editor) return;
    let markdown: string;
    try {
      // On the unmount flush the child editor may already be disposed; a dead
      // instance means nothing newer than the last change event to save.
      markdown = String(editor.getDocument('markdown') ?? '').trim();
    } catch {
      return;
    }
    // An emptied requirement is far more likely a half-finished edit than an
    // intent to drop the acceptance bar; keep the last saved text until the
    // user writes a replacement.
    if (!markdown || markdown === lastSavedRef.current) return;
    // The marker advances only on success: a transiently failed save stays
    // different from `lastSavedRef`, so the next edit (or the unmount flush)
    // retries the same content instead of silently considering it saved.
    updateGoalRequirement(goalId, markdown)
      .then(() => {
        lastSavedRef.current = markdown;
      })
      .catch((error) => {
        console.error('[GoalRequirement] Failed to save:', error);
        toast.error(t('goalProcess.requirementSaveFailed'));
      });
  }, [canEdit, editor, goalId, t, updateGoalRequirement]);

  // The unmount cleanup runs with the closure of a stale render; the ref keeps
  // it flushing the *current* document instead of an early one.
  const saveNowRef = useRef(saveNow);
  saveNowRef.current = saveNow;
  useEffect(
    () => () => {
      // Leaving the page inside the debounce window must not discard the edit —
      // flush it now instead of only cancelling the timer.
      if (debounceRef.current) clearTimeout(debounceRef.current);
      saveNowRef.current();
    },
    [],
  );

  const handleContentChange = useCallback(() => {
    if (!canEdit || !editor) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = undefined;
      saveNow();
    }, SAVE_DEBOUNCE_MS);
  }, [canEdit, editor, saveNow]);

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
