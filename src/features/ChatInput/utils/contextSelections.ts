import type { ChatContextContent, ContextSelection, PageSelection } from '@lobechat/types';

export interface MessageContextSelections {
  contextSelections: ContextSelection[];
  pageSelections: PageSelection[];
}

const toPageSelection = (context: ChatContextContent): PageSelection | undefined => {
  if (!context.pageId) return;

  return {
    content: context.preview || context.content,
    format: context.format,
    id: context.id,
    pageId: context.pageId,
    preview: context.preview,
    title: context.title,
    xml: context.xml || context.content,
  };
};

const toContextSelection = (context: ChatContextContent): ContextSelection => {
  if (context.source === 'code' || context.filePath) {
    return {
      content: context.content,
      filePath: context.filePath || '',
      format: context.format,
      id: context.id,
      language: context.language,
      lineRange: context.lineRange,
      preview: context.preview,
      side: context.side,
      source: 'code',
      title: context.title,
      workingDirectory: context.workingDirectory,
    };
  }

  if (context.pageId) {
    return {
      content: context.preview || context.content,
      format: context.format,
      id: context.id,
      lineRange: context.lineRange,
      pageId: context.pageId,
      preview: context.preview,
      source: 'page',
      title: context.title,
      xml: context.xml || context.content,
    };
  }

  return {
    content: context.content,
    format: context.format,
    id: context.id,
    lineRange: context.lineRange,
    preview: context.preview,
    source: 'text',
    title: context.title,
  };
};

export const buildMessageContextSelections = (
  contexts: ChatContextContent[],
): MessageContextSelections => {
  const contextSelections = contexts.map(toContextSelection);
  const pageSelections = contexts.flatMap((context) => {
    const pageSelection = toPageSelection(context);
    return pageSelection ? [pageSelection] : [];
  });

  return { contextSelections, pageSelections };
};
