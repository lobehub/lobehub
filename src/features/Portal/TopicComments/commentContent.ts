import type { TopicCommentJson, UpdateTopicCommentInput } from '@lobechat/types';

export const hasTopicCommentEditorData = (editorData: TopicCommentJson | null) =>
  Boolean(
    editorData &&
    typeof editorData === 'object' &&
    !Array.isArray(editorData) &&
    Object.keys(editorData).length > 0,
  );

export const createTopicCommentUpdateInput = (
  id: string,
  value: { content: string; editorData: TopicCommentJson },
): UpdateTopicCommentInput => ({
  content: value.content.trim(),
  editorData: value.editorData,
  id,
});
