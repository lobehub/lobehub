'use client';

import type { AgentMailComposeMode } from '@lobechat/types';
import { useDebounceFn, useLatest, useUnmount } from 'ahooks';
import { useEffect, useRef, useState } from 'react';

import {
  agentAccountService,
  type AgentMailDraftContent,
  type AgentMailDraftRow,
  type AgentMailRow,
} from '@/services/agentAccount';

import {
  backupKeyOf,
  cancelPendingDiscard,
  clearBackup,
  type ComposeFields,
  DRAFT_SAVE_DELAY_MS,
  EMPTY_FIELDS,
  forgetSendRefusal,
  initialFieldsFor,
  invalidAddresses,
  isBlankDraft,
  isReplyMode,
  readBackup,
  rememberSendRefusal,
  replySubject,
  sameFields,
  type SendFailure,
  sendFailureOf,
  withoutInvalid,
  writeBackup,
} from './compose';

export type DraftSaveState = 'failed' | 'idle' | 'saved' | 'saving';

export interface UseComposerParams {
  /** The address it goes out from. */
  accountId: string;
  agentId: string;
  /** Resume this saved draft, already read by the caller. */
  draft?: AgentMailDraftRow;
  mode: AgentMailComposeMode;
  /** A draft now exists on the server (first save, or a reply's resumed draft). */
  onDraftCreated?: (id: string) => void;
  /** This address's own mailbox address, left out of reply-all. */
  ownAddress: string;
  /** Revalidate the lists and counts a draft or a send changes. */
  refresh: () => Promise<unknown>;
  /** The line above a reply's quote, e.g. "On …, … wrote:". */
  replyHeader: string;
  /** The mail answered or forwarded. */
  source?: AgentMailRow;
}

export interface SentMail {
  mailId?: string;
}

/**
 * What the server stores. A malformed address is left out (the server refuses
 * the whole draft over one); it stays on screen and in the local copy, marked.
 */
const toContent = (mode: AgentMailComposeMode, fields: ComposeFields): AgentMailDraftContent => ({
  bcc: withoutInvalid(fields.bcc),
  cc: withoutInvalid(fields.cc),
  // A reply's subject is the original's; the server keeps it, so none is stored.
  subject: isReplyMode(mode) ? null : fields.subject,
  text: fields.text,
  to: withoutInvalid(fields.to),
});

const fieldsOfDraft = (
  draft: AgentMailDraftRow,
  source: AgentMailRow | undefined,
): ComposeFields => ({
  bcc: draft.bcc,
  cc: draft.cc,
  subject: isReplyMode(draft.mode) ? replySubject(source?.subject) : (draft.subject ?? ''),
  text: draft.text,
  to: draft.to,
});

const isNotFound = (error: unknown) =>
  (error as { data?: { code?: string } } | undefined)?.data?.code === 'NOT_FOUND';

/**
 * One composer's draft, from opening to sent.
 *
 * Every edit is copied to this browser at once and saved to the server once
 * the person pauses. Answering a mail opens (or resumes) its one draft for that
 * way of answering, which the server keeps unique; a new mail gets its draft on
 * the first save. Closing, switching away or unmounting saves silently, and a
 * draft that never got any writing is removed rather than left behind.
 *
 * Sending goes through the saved draft (`drafts.send`), which the server leases
 * so a double submit cannot send twice. The one exception is a forward that
 * leaves some of the original's attachments behind: drafts do not store that
 * choice, so it is sent directly and the draft deleted after.
 */
export const useComposer = (params: UseComposerParams) => {
  const { accountId, agentId, mode, source } = params;
  const paramsRef = useLatest(params);

  const initialKey = params.draft
    ? backupKeyOf(agentId, accountId, { draftId: params.draft.id })
    : backupKeyOf(agentId, accountId, { mode, sourceMailId: source?.id });

  const [fields, setFieldsState] = useState<ComposeFields>(EMPTY_FIELDS);
  const [excludedAttachments, setExcludedState] = useState<number[]>([]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<unknown>();
  const [saveState, setSaveState] = useState<DraftSaveState>('idle');
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<SendFailure>();

  const fieldsRef = useRef<ComposeFields>(EMPTY_FIELDS);
  const excludedRef = useRef<number[]>([]);
  const draftIdRef = useRef<string | undefined>(params.draft?.id);
  const backupKeyRef = useRef(initialKey);
  /** Edits the server does not have yet. */
  const dirtyRef = useRef(false);
  /** A draft this composer opened that nobody has written in; removed on close. */
  const blankRef = useRef(false);
  const savingRef = useRef<Promise<void> | undefined>(undefined);
  const closedRef = useRef(false);

  const backup = (pending = true) =>
    writeBackup(backupKeyRef.current, {
      excludedAttachments: excludedRef.current,
      fields: fieldsRef.current,
      pending,
      savedAt: Date.now(),
    });

  const save = async (): Promise<void> => {
    if (savingRef.current) {
      await savingRef.current;
      if (dirtyRef.current) return save();
      return;
    }
    if (!dirtyRef.current) return;

    const snapshot = fieldsRef.current;
    const { refresh } = paramsRef.current;
    dirtyRef.current = false;
    setSaveState('saving');

    const run = async () => {
      try {
        const content = toContent(mode, snapshot);
        const id = draftIdRef.current;
        if (id) {
          await agentAccountService.updateMailDraft(id, content);
        } else {
          const draft = await agentAccountService.createMailDraft({
            ...content,
            accountId,
            mode,
            sourceMailId: source?.id,
          });
          draftIdRef.current = draft.id;
          const nextKey = backupKeyOf(agentId, accountId, { draftId: draft.id });
          clearBackup(backupKeyRef.current);
          backupKeyRef.current = nextKey;
          if (dirtyRef.current) backup();
          paramsRef.current.onDraftCreated?.(draft.id);
          void refresh().catch(() => undefined);
        }
        if (!dirtyRef.current) {
          // The local copy is all that holds a malformed address (so it still
          // wins on the next open), or a forward's choice of attachments, which
          // drafts do not store.
          const invalid = invalidAddresses(snapshot).length > 0;
          if (invalid || excludedRef.current.length > 0) backup(invalid);
          else clearBackup(backupKeyRef.current);
        }
        setSaveState(dirtyRef.current ? 'saving' : 'saved');
      } catch (error) {
        console.error('[AgentMail] draft save failed', error);
        // Gone on the server (sent or discarded elsewhere): the next save starts a new one.
        if (draftIdRef.current && isNotFound(error)) draftIdRef.current = undefined;
        dirtyRef.current = true;
        setSaveState('failed');
        throw error;
      }
    };

    const promise = run().finally(() => {
      savingRef.current = undefined;
    });
    savingRef.current = promise.catch(() => undefined);
    await promise;
    if (dirtyRef.current) return save();
  };

  const debouncedSave = useDebounceFn(() => void save().catch(() => undefined), {
    wait: DRAFT_SAVE_DELAY_MS,
  });

  // Open: the saved draft, or this mail's draft for this mode, or a fresh one;
  // a copy in this browser holding what the server never got wins.
  useEffect(() => {
    let cancelled = false;

    const adopt = (next: ComposeFields, options: { dirty: boolean; excluded?: number[] }) => {
      fieldsRef.current = next;
      excludedRef.current = options.excluded ?? [];
      dirtyRef.current = options.dirty;
      setFieldsState(next);
      setExcludedState(excludedRef.current);
      setReady(true);
      if (options.dirty) debouncedSave.run();
    };

    const resume = (draft: AgentMailDraftRow) => {
      // Opened again within a discard's undo window: keep it.
      cancelPendingDiscard(draft.id);
      draftIdRef.current = draft.id;
      const key = backupKeyOf(agentId, accountId, { draftId: draft.id });
      // Typed before the draft existed, against the mail it answers.
      const early = readBackup(backupKeyRef.current);
      if (backupKeyRef.current !== key) clearBackup(backupKeyRef.current);
      backupKeyRef.current = key;
      const local = readBackup(key) ?? early;
      const fresh = isBlankDraft(draft);
      const initial = fresh
        ? initialFieldsFor(mode, source, params.ownAddress, params.replyHeader)
        : fieldsOfDraft(draft, source);
      const newer = local?.pending && !sameFields(local.fields, initial);
      blankRef.current = fresh && !newer;
      adopt(newer ? local.fields : initial, {
        dirty: Boolean(newer),
        excluded: local?.excludedAttachments,
      });
    };

    const open = async () => {
      try {
        if (params.draft) {
          resume(params.draft);
        } else if (mode !== 'compose' && source) {
          const draft = await agentAccountService.createMailDraft({
            accountId,
            mode,
            sourceMailId: source.id,
          });
          if (cancelled) return;
          resume(draft);
          paramsRef.current.onDraftCreated?.(draft.id);
          void paramsRef.current.refresh().catch(() => undefined);
        } else {
          const local = readBackup(backupKeyRef.current);
          adopt(local?.fields ?? EMPTY_FIELDS, { dirty: Boolean(local) });
        }
      } catch (error) {
        if (!cancelled) setLoadError(error);
      }
    };

    void open();
    return () => {
      cancelled = true;
    };
    // Opened once; the parent keys the composer by draft and mode.
  }, []);

  const setFields = (patch: Partial<ComposeFields>) => {
    if (sending || closedRef.current) return;
    fieldsRef.current = { ...fieldsRef.current, ...patch };
    dirtyRef.current = true;
    blankRef.current = false;
    setFieldsState(fieldsRef.current);
    setFailure(undefined);
    backup();
    debouncedSave.run();
  };

  const toggleAttachment = (index: number) => {
    excludedRef.current = excludedRef.current.includes(index)
      ? excludedRef.current.filter((item) => item !== index)
      : [...excludedRef.current, index];
    blankRef.current = false;
    setExcludedState(excludedRef.current);
    backup();
  };

  /** Save what is there now, e.g. for Mod+S; failures show in the save state. */
  const saveNow = () => {
    debouncedSave.cancel();
    if (!dirtyRef.current && draftIdRef.current) return Promise.resolve();
    dirtyRef.current = true;
    return save().catch(() => undefined);
  };

  /** Leave quietly: what was written is saved, a draft nobody wrote in is removed. */
  const close = async () => {
    if (closedRef.current) return;
    closedRef.current = true;
    debouncedSave.cancel();
    if (blankRef.current && draftIdRef.current) {
      clearBackup(backupKeyRef.current);
      await agentAccountService
        .deleteMailDrafts([draftIdRef.current])
        .then(() => paramsRef.current.refresh())
        .catch(() => undefined);
      return;
    }
    // A failed save keeps the local copy, which the next open picks up.
    if (dirtyRef.current) await save().catch(() => undefined);
  };

  useUnmount(() => {
    void close();
  });

  const send = async (): Promise<SentMail | undefined> => {
    if (sending || closedRef.current) return;
    setSending(true);
    setFailure(undefined);
    debouncedSave.cancel();

    try {
      // A save already on its way may not have reached the server; the send
      // reads the stored draft, so it must not overtake that save.
      if (savingRef.current) await savingRef.current;
      if (dirtyRef.current || !draftIdRef.current) {
        dirtyRef.current = true;
        await save();
      }
      const id = draftIdRef.current!;
      const excluded = excludedRef.current;
      let result: SentMail;
      if (mode === 'forward' && excluded.length > 0 && source) {
        const keep = source.attachments
          .map((attachment) => attachment.index)
          .filter((index) => !excluded.includes(index));
        result = await agentAccountService.sendMail({
          ...toContent(mode, fieldsRef.current),
          accountId,
          forwardAttachmentIndexes: keep,
          mode,
          sourceMailId: source.id,
          text: fieldsRef.current.text,
        });
        await agentAccountService.deleteMailDrafts([id]).catch(() => undefined);
      } else {
        result = await agentAccountService.sendMailDraft(id);
      }

      closedRef.current = true;
      clearBackup(backupKeyRef.current);
      forgetSendRefusal(accountId);
      void paramsRef.current.refresh().catch(() => undefined);
      return result;
    } catch (error) {
      console.error('[AgentMail] send failed', error);
      const next = sendFailureOf(error);
      rememberSendRefusal(accountId, next.code);
      setFailure(next);
      return undefined;
    } finally {
      setSending(false);
    }
  };

  /** Stop composing and drop the draft; the caller offers the undo. */
  const detach = async () => {
    closedRef.current = true;
    debouncedSave.cancel();
    // Whatever was typed is saved first, so undoing the discard brings it back whole.
    if (dirtyRef.current) await save().catch(() => undefined);
    clearBackup(backupKeyRef.current);
    return draftIdRef.current;
  };

  return {
    close,
    detach,
    draftId: draftIdRef.current,
    excludedAttachments,
    failure,
    fields,
    loadError,
    ready,
    saveNow,
    saveState,
    send,
    sending,
    setFields,
    toggleAttachment,
  };
};
