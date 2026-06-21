/**
 * Inject a refer-topic node at the beginning of editorData.
 * Prepends a new paragraph containing the refer-topic node before existing content.
 */
export const injectReferTopicNode = (
  editorData: Record<string, any> | undefined,
  topicId: string,
  topicTitle: string,
): Record<string, any> => {
  const referTopicNode = {
    type: 'refer-topic',
    topicId,
    topicTitle,
    version: 1,
  };

  const referParagraph = {
    children: [referTopicNode],
    direction: 'ltr',
    format: '',
    indent: 0,
    type: 'paragraph',
    version: 1,
  };

  // If no editorData, create a minimal structure with just the referTopic
  if (!editorData?.root) {
    return {
      root: {
        children: [referParagraph],
        direction: 'ltr',
        format: '',
        indent: 0,
        type: 'root',
        version: 1,
      },
    };
  }

  // Deep clone and prepend refer-topic paragraph
  const cloned = structuredClone(editorData);
  const existingChildren = cloned.root.children || [];
  cloned.root.children = [referParagraph, ...existingChildren];
  return cloned;
};
