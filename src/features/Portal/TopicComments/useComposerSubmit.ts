import type { CreateTopicCommentInput } from '@lobechat/types';
import { nanoid } from 'nanoid';
import type { RefObject } from 'react';
import { useCallback, useRef, useState } from 'react';

import type { TopicCommentDraft } from '@/store/topicComment/initialState';

import type { TopicCommentEditorRef } from './TopicCommentEditor';

interface UseComposerSubmitOptions {
  clearDraft: (key: string, expectedClientId?: string) => void;
  content: string;
  create: (
    input: CreateTopicCommentInput,
    options: { rootReplyCount?: number },
  ) => Promise<unknown>;
  creating: boolean;
  draft?: TopicCommentDraft;
  editorRef: RefObject<TopicCommentEditorRef | null>;
  key: string;
  messageId?: string;
  onCreated?: () => void;
  onError: () => void;
  parentCommentId?: string;
  rootReplyCount?: number;
  setDraft: (key: string, draft: TopicCommentDraft) => void;
  shouldSendOnEnter: (event: KeyboardEvent) => boolean;
  topicId: string;
}

export const useComposerSubmit = ({
  clearDraft,
  content,
  create,
  creating,
  draft,
  editorRef,
  key,
  messageId,
  onCreated,
  onError,
  parentCommentId,
  rootReplyCount,
  setDraft,
  shouldSendOnEnter,
  topicId,
}: UseComposerSubmitOptions) => {
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(async () => {
    const editorValue = editorRef.current?.getValue() ?? {
      content,
      editorData: draft?.editorData ?? null,
    };
    const value = editorValue.content.trim();
    if (!key || !value || creating || submittingRef.current) return;

    submittingRef.current = true;
    setSubmitting(true);
    const clientId = draft?.clientId ?? nanoid();
    const submittedDraft = { clientId, ...editorValue };
    setDraft(key, submittedDraft);
    clearDraft(key, clientId);
    editorRef.current?.clean();
    try {
      await create(
        {
          clientId,
          content: value,
          editorData: editorValue.editorData,
          messageId,
          parentCommentId,
          topicId,
        },
        { rootReplyCount },
      );
      onCreated?.();
    } catch {
      setDraft(key, submittedDraft);
      editorRef.current?.setValue(editorValue);
      editorRef.current?.focus();
      onError();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [
    clearDraft,
    content,
    create,
    creating,
    draft?.clientId,
    draft?.editorData,
    editorRef,
    key,
    messageId,
    onCreated,
    onError,
    parentCommentId,
    rootReplyCount,
    setDraft,
    topicId,
  ]);

  const onPressEnter = useCallback(
    (event: KeyboardEvent) => {
      if (!shouldSendOnEnter(event)) return;
      void submit();
      return true;
    },
    [shouldSendOnEnter, submit],
  );

  return { onPressEnter, submit, submitting };
};
