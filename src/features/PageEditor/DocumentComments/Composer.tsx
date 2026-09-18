import type { DocumentCommentJson, DocumentCommentSelectionAnchor } from '@lobechat/types';
import { ChatInput, ChatInputActionBar, SendButton, useEditor } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { Avatar, Button, toast } from '@lobehub/ui/base-ui';
import { nanoid } from 'nanoid';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { AttachmentMenu } from '@/features/AttachmentInput';
import { TypoBar } from '@/features/EditorCanvas';
import {
  getEditorAttachmentStateFromJson,
  insertExistingAttachmentsIntoEditor,
  insertFilesIntoEditor,
} from '@/features/EditorCanvas/editorAttachments';
import { useEnterToSend } from '@/hooks/useEnterToSend';
import { useLocalStorageState } from '@/hooks/useLocalStorageState';
import { usePermission } from '@/hooks/usePermission';
import { useUserAvatar } from '@/hooks/useUserAvatar';

import { usePageEditorStore, useStoreApi } from '../store';
import AnchorQuote from './anchor/AnchorQuote';
import { prefersReducedMotion } from './anchor/commentLocator';
import { useCommentAnchors } from './anchor/context';
import DocumentCommentEditor, { type DocumentCommentEditorRef } from './DocumentCommentEditor';
import type { DocumentCommentSubmitInput } from './optimistic';
import { COMMENT_INPUT_MAX_HEIGHT, styles } from './styles';
import { useGutterComposerFocus } from './useGutterComposerFocus';

export interface Draft {
  clientId: string;
  content: string;
  editorData: DocumentCommentJson | null;
  /**
   * Persisted alongside the text so a reload can't turn a comment the reader
   * started on a specific run into a comment about the whole document.
   */
  selectionAnchor?: DocumentCommentSelectionAnchor;
}

const getDraftKey = (workspaceId: string | null | undefined, documentId: string, scope: string) =>
  `document-comment-draft:${workspaceId ?? 'personal'}:${documentId}:${scope}`;

/**
 * The gutter composer only mounts once a pending anchor exists in the store,
 * but the store doesn't survive a reload while the draft does — so nothing
 * would ever re-publish it. Read the persisted anchor directly, outside the
 * composer, to break that chicken-and-egg gate.
 */
export const readAnchoredDraftAnchor = (
  workspaceId: string | null | undefined,
  documentId: string,
): DocumentCommentSelectionAnchor | undefined => {
  try {
    const raw = window.localStorage.getItem(getDraftKey(workspaceId, documentId, 'anchored'));
    if (!raw) return undefined;
    return (JSON.parse(raw) as Draft).selectionAnchor;
  } catch {
    return undefined;
  }
};

/**
 * Moves a stranded document-level draft's full contents — not just its
 * anchor — into the gutter's own scope. The anchor alone would leave the
 * gutter's draft empty while the text and attachments stay behind in the
 * now-unanchored document-level box.
 */
export const migrateDraftToAnchoredScope = (
  workspaceId: string | null | undefined,
  documentId: string,
  draft: Draft,
): void => {
  try {
    window.localStorage.setItem(
      getDraftKey(workspaceId, documentId, 'anchored'),
      JSON.stringify(draft),
    );
  } catch {
    // ignore write failures (private mode, quota)
  }
};

/**
 * A failed anchored submission whose shared slot was reclaimed by a newer
 * pick before the request settled: restoring it there would overwrite the
 * newer draft, but discarding it outright loses the reader's typed text and
 * attachments for a network blip that was never their fault. Stash it under
 * its own key, scoped by clientId, instead — no browsing UI reads it back
 * yet, but it survives rather than vanishing silently.
 */
export const preserveFailedAnchoredDraft = (
  workspaceId: string | null | undefined,
  documentId: string,
  draft: Draft,
): void => {
  try {
    window.localStorage.setItem(
      getDraftKey(workspaceId, documentId, `anchored-failed:${draft.clientId}`),
      JSON.stringify(draft),
    );
  } catch {
    // ignore write failures (private mode, quota)
  }
};

/**
 * Before gutter and inline shared a scope, inline mode stored every root
 * draft — anchored or not — under 'root'. Returns a legacy draft still
 * sitting there, or `null` when there is nothing to migrate or the new
 * ('anchored') scope already has content of its own to protect. A cancelled
 * or already-submitted anchored draft leaves an empty-but-present record
 * behind (see `submit`'s and `cancel`'s up-front clear), which doesn't count
 * as "content of its own" — otherwise the very first cancel or send in
 * anchored/gutter mode would block this migration forever.
 */
export const readLegacyRootDraft = (
  workspaceId: string | null | undefined,
  documentId: string,
): Draft | null => {
  try {
    const anchoredRaw = window.localStorage.getItem(
      getDraftKey(workspaceId, documentId, 'anchored'),
    );
    if (anchoredRaw) {
      const anchored = JSON.parse(anchoredRaw) as Draft;
      if (anchored.content || anchored.editorData || anchored.selectionAnchor) return null;
    }
    const raw = window.localStorage.getItem(getDraftKey(workspaceId, documentId, 'root'));
    if (!raw) return null;
    const legacy = JSON.parse(raw) as Draft;
    if (!legacy.content && !legacy.editorData && !legacy.selectionAnchor) return null;
    return legacy;
  } catch {
    return null;
  }
};

export const clearLegacyRootDraft = (
  workspaceId: string | null | undefined,
  documentId: string,
): void => {
  try {
    window.localStorage.removeItem(getDraftKey(workspaceId, documentId, 'root'));
  } catch {
    // ignore
  }
};

/**
 * The mirror image of `readLegacyRootDraft`: a plain comment started in
 * `AgentDocumentPage` (no panel, so its composer shares the gutter's
 * 'anchored' scope even though it never adopted a selection there) is
 * invisible once the same document opens in a panel-capable layout, whose
 * document-level composer only ever reads 'root'. Returns that draft, or
 * `null` when there is nothing to adopt or 'root' already has content of
 * its own to protect.
 */
export const readUnanchoredDraftFromAnchoredScope = (
  workspaceId: string | null | undefined,
  documentId: string,
): Draft | null => {
  try {
    const rootRaw = window.localStorage.getItem(getDraftKey(workspaceId, documentId, 'root'));
    if (rootRaw) {
      const root = JSON.parse(rootRaw) as Draft;
      if (root.content || root.editorData) return null;
    }
    const raw = window.localStorage.getItem(getDraftKey(workspaceId, documentId, 'anchored'));
    if (!raw) return null;
    const draft = JSON.parse(raw) as Draft;
    if (draft.selectionAnchor) return null;
    if (!draft.content && !draft.editorData) return null;
    return draft;
  } catch {
    return null;
  }
};

export const clearAnchoredScopeDraft = (
  workspaceId: string | null | undefined,
  documentId: string,
): void => {
  try {
    window.localStorage.removeItem(getDraftKey(workspaceId, documentId, 'anchored'));
  } catch {
    // ignore
  }
};

/**
 * How a root composer relates to the selection being commented on.
 *
 * - `gutter`: the composer beside the text. Exists only while a selection is
 *   pending, adopts it, and keeps its own draft.
 * - `inline`: the composer below the body on a pane too narrow for a gutter.
 *   Adopts the pending selection and scrolls itself into view for it.
 * - `none`: the document-level composer below the body while a gutter is
 *   present. Never adopts a selection — that is the gutter composer's job.
 */
export type ComposerAnchorMode = 'gutter' | 'inline' | 'none';

interface ComposerProps {
  anchorMode?: ComposerAnchorMode;
  documentId: string;
  /**
   * Whether the gutter composer's card is positioned and visible. The gutter
   * hides a card until it has measured where it goes, and a hidden box cannot
   * take the caret, so the focus for a fresh selection waits on this.
   */
  focusReady?: boolean;
  /** Dismiss a reply box: the draft is dropped and the caller closes it. */
  onCancel?: () => void;
  onSubmit: (input: DocumentCommentSubmitInput) => Promise<void>;
  onSuccess?: () => void;
  parentCommentId?: string;
  /**
   * The bare layout used beside the text: no avatar, no quote row, no
   * emphasis ring, actions underneath. The gutter composer always uses it;
   * a reply box inside a panel card opts in.
   */
  plain?: boolean;
}

const Composer = memo<ComposerProps>(
  ({
    anchorMode = 'none',
    documentId,
    focusReady = true,
    onCancel,
    onSubmit,
    onSuccess,
    parentCommentId,
    plain = false,
  }) => {
    const { t } = useTranslation('file');
    const workspaceId = useActiveWorkspaceId();
    const { allowed: canCreate } = usePermission('create_content');
    const avatar = useUserAvatar();
    const shouldSendOnEnter = useEnterToSend();
    const editor = useEditor();
    const editorRef = useRef<DocumentCommentEditorRef>(null);
    const inputRef = useRef<HTMLDivElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    // Set by the legacy-migration effect below when this mount adopted an
    // unanchored 'root' draft into 'anchored'; `submit` clears the original
    // once that migrated copy is actually sent.
    const migratedUnanchoredLegacyRef = useRef(false);
    // Same idea, the other direction: set when this 'none'-mode mount adopted
    // an unanchored draft that a panel-less page had left under 'anchored'.
    const adoptedUnanchoredFromAnchoredRef = useRef(false);
    const submittingRef = useRef(false);
    // Only a root comment can be anchored; a reply shares its thread's anchor.
    const isRootComposer = !parentCommentId;
    const isGutterComposer = isRootComposer && anchorMode === 'gutter';
    const isPlain = isGutterComposer || plain;
    const adoptsAnchor = isRootComposer && anchorMode !== 'none';
    // An anchor-adopting composer (gutter or inline) and the document-level
    // composer beside it can be open at the same time, so each keeps its own
    // draft; gutter and inline never coexist (inline only exists without a
    // gutter), so they safely share the same scope across that layout switch
    // instead of stranding one side's content when it happens.
    //
    // A reply box is different: an anchored thread with a gutter open renders
    // twice (gutter + flat list, see Thread's `compact` prop, which `plain`
    // mirrors 1:1 for a reply composer), and both copies stay independently
    // interactive. Sharing one draft key would hydrate both with the same
    // `clientId`; submitting either one first would then have the other's
    // later submit reuse that id as an idempotency key and silently return
    // the first reply instead of creating a second one. Key a reply's scope
    // by which copy it is so the two can never collide.
    const draftScope = parentCommentId
      ? `${parentCommentId}${plain ? ':compact' : ''}`
      : adoptsAnchor
        ? 'anchored'
        : 'root';
    const draftKey = getDraftKey(workspaceId, documentId, draftScope);
    const [draft, setDraft] = useLocalStorageState<Draft>(draftKey, {
      clientId: nanoid(),
      content: '',
      editorData: null,
    });
    // The store outlives a document switch, so a quote captured in another
    // document is not this composer's to adopt.
    const pendingAnchor = usePageEditorStore((s) =>
      s.pendingCommentAnchor?.documentId === documentId ? s.pendingCommentAnchor.anchor : undefined,
    );
    const setPendingCommentAnchor = usePageEditorStore((s) => s.setPendingCommentAnchor);
    // Read fresh in the submit failure handler below, never through the
    // reactive selector: that closure is a snapshot from before the await,
    // so it can't see a newer pick that happened while the request was
    // in flight.
    const storeApi = useStoreApi();
    const anchor = adoptsAnchor ? draft.selectionAnchor : undefined;
    const [showTypoBar, setShowTypoBar] = useLocalStorageState(
      'document-comment:show-formatting-toolbar',
      false,
    );
    const [submitting, setSubmitting] = useState(false);
    // The draft lives in storage as well as in state. Storage is written from
    // inside the state updater, which React only runs when the box renders
    // again — and releasing the selection unmounts the gutter box in the
    // same batch, so a draft dropped that way would come back on the next
    // open. Writes that must outlive the box go to storage directly.
    const persistDraft = useCallback(
      (next: Draft) => {
        try {
          window.localStorage.setItem(draftKey, JSON.stringify(next));
        } catch {
          // ignore write failures (private mode, quota)
        }
        setDraft(next);
      },
      [draftKey, setDraft],
    );

    // Intake: the toolbar drops a freshly captured selection into the store and
    // the anchored composer adopts it as its draft anchor.
    useEffect(() => {
      if (!adoptsAnchor || !pendingAnchor) return;
      setDraft((current) =>
        current.selectionAnchor === pendingAnchor
          ? current
          : { ...current, selectionAnchor: pendingAnchor },
      );
    }, [adoptsAnchor, pendingAnchor, setDraft]);

    // Restore: the draft outlives a reload, the store doesn't, so republish the
    // draft's anchor to keep the body highlight in sync with what will be sent.
    useEffect(() => {
      if (!adoptsAnchor || !anchor || pendingAnchor) return;
      setPendingCommentAnchor({ anchor, documentId });
    }, [adoptsAnchor, anchor, documentId, pendingAnchor, setPendingCommentAnchor]);

    // A document-level composer next to a gutter never sends an anchor. One
    // left in its draft (from a narrower pane, before a gutter existed) is
    // handed to the gutter composer completely — text and attachments
    // included, not just the anchor — since the anchor alone would leave the
    // gutter's draft empty while the words stay behind in this now-unanchored
    // box, publishable as an unrelated document-level comment.
    useEffect(() => {
      if (anchorMode !== 'none' || !isRootComposer || !draft.selectionAnchor) return;
      const anchor = draft.selectionAnchor;
      migrateDraftToAnchoredScope(workspaceId, documentId, draft);
      persistDraft({ clientId: nanoid(), content: '', editorData: null });
      if (!pendingAnchor) setPendingCommentAnchor({ anchor, documentId });
    }, [
      anchorMode,
      documentId,
      draft,
      isRootComposer,
      pendingAnchor,
      persistDraft,
      setPendingCommentAnchor,
      workspaceId,
    ]);

    // The mirror image of the effect above: a plain comment started in
    // AgentDocumentPage (no panel, so its composer shares the gutter's
    // 'anchored' scope even though it never adopted a selection) is
    // invisible once this same document opens in a panel-capable layout,
    // whose own composer only ever reads 'root'. Adopt it on mount, before
    // this composer's own 'root' draft has ever been written.
    useEffect(() => {
      adoptedUnanchoredFromAnchoredRef.current = false;
      if (anchorMode !== 'none' || !isRootComposer) return;
      const orphaned = readUnanchoredDraftFromAnchoredScope(workspaceId, documentId);
      if (!orphaned) return;
      setDraft(orphaned);
      // Leave 'anchored' in place until this adopted copy is actually sent —
      // see `submit` — or narrowing back to a panel-less layout before then
      // would orphan it again.
      adoptedUnanchoredFromAnchoredRef.current = true;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [anchorMode, isRootComposer, documentId, workspaceId]);

    // One-time upgrade: before gutter and inline shared a scope, inline mode
    // stored every root draft — anchored or not — under 'root'. Adopt a
    // legacy draft still sitting there once, on mount, before this
    // composer's own 'anchored'-scope draft has ever been written, so an
    // unfinished plain comment from before the upgrade doesn't just vanish.
    useEffect(() => {
      migratedUnanchoredLegacyRef.current = false;
      if (anchorMode !== 'inline' || !isRootComposer) return;
      const legacy = readLegacyRootDraft(workspaceId, documentId);
      if (!legacy) return;
      setDraft(legacy);
      // An anchored legacy draft belongs exclusively in the new scope now.
      // An unanchored one never adopted an anchor to begin with, so 'none'
      // mode's own composer still needs it until this migrated copy is
      // actually sent — clearing it here, before that, would orphan it if
      // the pane widens back to a gutter layout first. `submit` clears it
      // once the migrated copy it is standing in for has gone out, using
      // this ref (both scopes can only be written from this one composer
      // while it's mounted, since 'none' and 'inline' never coexist).
      if (legacy.selectionAnchor) clearLegacyRootDraft(workspaceId, documentId);
      else migratedUnanchoredLegacyRef.current = true;
      // Deliberately excludes `draft` and `setDraft`: this effect is what
      // writes the draft, and depending on it would re-check on every
      // keystroke instead of once per document.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [anchorMode, isRootComposer, documentId, workspaceId]);

    // The inline composer sits below the body, so a selection made further up
    // has to bring it into view before it can be typed into. The gutter
    // composer needs neither: it mounts level with the selection, and only
    // has to take focus.
    const previousPendingRef = useRef(pendingAnchor);
    useEffect(() => {
      const arrived = pendingAnchor && previousPendingRef.current !== pendingAnchor;
      previousPendingRef.current = pendingAnchor;
      if (!arrived || anchorMode !== 'inline') return;
      // One frame of delay lets the quote row render first, so the scroll
      // lands on the composer's real height.
      const frame = requestAnimationFrame(() => {
        rootRef.current?.scrollIntoView({
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          block: 'center',
        });
        // Focus without its own scroll: the editor's focus would otherwise
        // cut the glide short at "caret barely visible".
        rootRef.current
          ?.querySelector<HTMLElement>('[contenteditable="true"]')
          ?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(frame);
    }, [anchorMode, pendingAnchor]);

    // A fresh selection wants the caret in the gutter composer; see the hook
    // for why that is neither a single call nor a plain autoFocus.
    const pickVersion = usePageEditorStore((s) => s.pendingCommentAnchorVersion);
    const gutterPick = isGutterComposer && anchor ? pickVersion || 1 : 0;
    useGutterComposerFocus({ editorRef, pick: gutterPick, ready: focusReady, rootRef });

    const clearAnchor = useCallback(() => {
      setDraft((current) => ({ ...current, selectionAnchor: undefined }));
      setPendingCommentAnchor(undefined);
    }, [setDraft, setPendingCommentAnchor]);

    // Cancelling the gutter composer drops the whole draft, quote and text: it
    // has nowhere to live once the selection it was written against is gone.
    const cancel = useCallback(() => {
      persistDraft({ clientId: nanoid(), content: '', editorData: null });
      if (isGutterComposer) setPendingCommentAnchor(undefined);
      editorRef.current?.clean();
      onCancel?.();
    }, [isGutterComposer, onCancel, persistDraft, setPendingCommentAnchor]);

    // Clicking back into the document while the box beside it is still empty
    // dismisses the box and its highlight, the way Yuque does: the reader has
    // moved on. A box with something typed in it is left alone — a stray
    // click must not throw away a half-written comment.
    const { bodyElement } = useCommentAnchors();
    const draftRef = useRef(draft);
    draftRef.current = draft;
    const cancelRef = useRef(cancel);
    cancelRef.current = cancel;
    useEffect(() => {
      if (!isGutterComposer || !bodyElement) return;
      const handlePointerDown = () => {
        const current = draftRef.current;
        const attachments = getEditorAttachmentStateFromJson(current.editorData);
        if (
          current.content.trim() ||
          attachments.hasCompletedAttachments ||
          attachments.hasIncompleteAttachments
        )
          return;
        cancelRef.current();
      };
      bodyElement.addEventListener('mousedown', handlePointerDown);
      return () => bodyElement.removeEventListener('mousedown', handlePointerDown);
    }, [bodyElement, isGutterComposer]);

    const submit = useCallback(async () => {
      const editorValue = editorRef.current?.getValue() ?? {
        content: draft.content,
        editorData: draft.editorData,
      };
      const content = editorValue.content.trim();
      const attachmentState = getEditorAttachmentStateFromJson(editorValue.editorData);
      if (
        !workspaceId ||
        !canCreate ||
        attachmentState.hasIncompleteAttachments ||
        (!content && !attachmentState.hasCompletedAttachments) ||
        submittingRef.current
      )
        return;

      submittingRef.current = true;
      setSubmitting(true);
      const submittedDraft = { clientId: draft.clientId, ...editorValue, selectionAnchor: anchor };
      // Clear up front so the optimistic card reads as the sent comment. For
      // the gutter composer, releasing the selection unmounts the box, and
      // the optimistic card takes its place beside the text at once; a box
      // still showing the same words with a spinner would read as a
      // duplicate that failed to close. The store's pending anchor is shared
      // by the whole document, so only the composer that captured it — a
      // reply or the unanchored document-level composer never did — may
      // release it; otherwise a reply's or that composer's own submit would
      // strand an unrelated in-progress gutter draft.
      persistDraft({ clientId: nanoid(), content: '', editorData: null });
      if (adoptsAnchor && anchor) setPendingCommentAnchor(undefined);
      editorRef.current?.clean();
      try {
        await onSubmit({
          clientId: submittedDraft.clientId,
          content,
          editorData: editorValue.editorData,
          selectionAnchor: anchor,
        });
        // The migrated legacy copy this submission was standing in for has
        // now gone out; the original 'root' record would otherwise freeze at
        // its pre-migration text and resurface it — already-sent — the next
        // time this document opens in a panel-capable layout.
        if (migratedUnanchoredLegacyRef.current) {
          clearLegacyRootDraft(workspaceId, documentId);
          migratedUnanchoredLegacyRef.current = false;
        }
        // Same idea for the copy adopted from 'anchored': once this submit
        // sends it, the panel-less page's own draft is no longer standing in
        // for an unfinished comment and can be dropped.
        if (adoptedUnanchoredFromAnchoredRef.current) {
          clearAnchoredScopeDraft(workspaceId, documentId);
          adoptedUnanchoredFromAnchoredRef.current = false;
        }
        onSuccess?.();
      } catch {
        // Releasing the anchor unmounted this box, so the reader could have
        // already picked a new selection and started a different draft in
        // the same shared 'anchored' slot while this request was in flight.
        // Restoring into that slot now would overwrite their text or
        // re-point their draft at this failed submission's anchor instead of
        // theirs — only restore when nothing has claimed it since.
        const slotStillEmpty = storeApi.getState().pendingCommentAnchor === undefined;
        if (isGutterComposer && anchor && slotStillEmpty) {
          // The box is gone by now: the draft goes back to storage, where
          // the box reads it when the republished selection mounts it again.
          persistDraft(submittedDraft);
          setPendingCommentAnchor({ anchor, documentId });
        } else if (isGutterComposer && anchor) {
          preserveFailedAnchoredDraft(workspaceId, documentId, submittedDraft);
        } else {
          setDraft((current) => (current.content ? current : submittedDraft));
          editorRef.current?.setValue(editorValue);
          editorRef.current?.focus();
        }
        toast.error(t('pageEditor.comments.createFailed'));
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }, [
      adoptsAnchor,
      anchor,
      canCreate,
      documentId,
      draft,
      isGutterComposer,
      onSubmit,
      onSuccess,
      persistDraft,
      setDraft,
      setPendingCommentAnchor,
      storeApi,
      t,
      workspaceId,
    ]);

    const handleAttach = useCallback(
      (files: File[]) => {
        insertFilesIntoEditor(editor, files);
      },
      [editor],
    );

    if (!workspaceId || !canCreate) return null;
    // A reply box stands in for the reply it is sending: the optimistic card
    // takes its place until the request settles. (The gutter box needs no
    // such rule: releasing its selection on submit unmounts it outright.)
    if (submitting && parentCommentId) return null;
    // The gutter composer exists for its selection; until the draft has
    // adopted it there is nothing to show.
    if (isGutterComposer && !anchor) return null;

    const attachmentState = getEditorAttachmentStateFromJson(draft.editorData);
    const canSend =
      !attachmentState.hasIncompleteAttachments &&
      (Boolean(draft.content.trim()) || attachmentState.hasCompletedAttachments);

    const editorNode = (
      <DocumentCommentEditor
        autoFocus={Boolean(parentCommentId) || isGutterComposer}
        disabled={submitting}
        editor={editor}
        entityId={draft.clientId}
        flush={isPlain}
        getPopupContainer={() => inputRef.current}
        initialContent={draft.content}
        initialEditorData={draft.editorData}
        ref={editorRef}
        placeholder={
          parentCommentId
            ? t('pageEditor.comments.replyPlaceholder')
            : t('pageEditor.comments.placeholder')
        }
        onChange={({ content, editorData }) => {
          setDraft((current) => ({ ...current, content, editorData }));
        }}
        onPressEnter={(event) => {
          if (!shouldSendOnEnter(event)) return;
          void submit();
          return true;
        }}
      />
    );
    const attachmentMenu = (
      <AttachmentMenu
        disabled={submitting}
        formatEnabled={showTypoBar}
        onFiles={handleAttach}
        onFormatEnabledChange={setShowTypoBar}
        onLibraryFiles={(attachments) => insertExistingAttachmentsIntoEditor(editor, attachments)}
      />
    );

    // Beside the text the selection is already visible in the body, so the
    // box is a plain input with its actions underneath — no quote row, no
    // avatar, no emphasis ring.
    if (isPlain) {
      return (
        <Flexbox gap={8} ref={rootRef}>
          <ChatInput
            className={styles.composerPlain}
            header={showTypoBar ? <TypoBar editor={editor} /> : undefined}
            maxHeight={COMMENT_INPUT_MAX_HEIGHT}
            minHeight={56}
            resize={false}
            slashMenuRef={inputRef}
            footer={
              <ChatInputActionBar
                left={attachmentMenu}
                style={{ paddingBlock: 4, paddingInline: 8 }}
              />
            }
            onBodyClick={() => editor.focus()}
          >
            {editorNode}
          </ChatInput>
          <Flexbox horizontal gap={8} justify={'flex-end'}>
            <Button disabled={submitting} onClick={cancel}>
              {t('pageEditor.comments.cancel')}
            </Button>
            <Button
              disabled={!canSend}
              loading={submitting}
              type={'primary'}
              onClick={() => void submit()}
            >
              {parentCommentId
                ? t('pageEditor.comments.replyAction')
                : t('pageEditor.comments.publish')}
            </Button>
          </Flexbox>
        </Flexbox>
      );
    }

    return (
      <Flexbox horizontal align={'flex-start'} gap={12} ref={rootRef}>
        <Flexbox className={styles.composerAvatar}>
          <Avatar avatar={avatar} size={parentCommentId ? 28 : 32} />
        </Flexbox>
        <ChatInput
          className={styles.composer}
          flex={1}
          maxHeight={COMMENT_INPUT_MAX_HEIGHT}
          minHeight={72}
          resize={false}
          slashMenuRef={inputRef}
          footer={
            <ChatInputActionBar
              left={attachmentMenu}
              style={{ paddingBlock: 4, paddingInline: 8 }}
              right={
                <SendButton
                  disabled={!canSend}
                  loading={submitting}
                  shape={'round'}
                  type={'primary'}
                  title={
                    parentCommentId
                      ? t('pageEditor.comments.replyAction')
                      : t('pageEditor.comments.publish')
                  }
                  onClick={() => void submit()}
                />
              }
            />
          }
          header={
            anchor || showTypoBar ? (
              <>
                {anchor && (
                  <AnchorQuote
                    anchor={anchor}
                    className={styles.composerAnchor}
                    onDismiss={clearAnchor}
                  />
                )}
                {showTypoBar && <TypoBar editor={editor} />}
              </>
            ) : undefined
          }
          onBodyClick={() => editor.focus()}
        >
          {editorNode}
        </ChatInput>
      </Flexbox>
    );
  },
);

Composer.displayName = 'DocumentCommentComposer';

export default Composer;
