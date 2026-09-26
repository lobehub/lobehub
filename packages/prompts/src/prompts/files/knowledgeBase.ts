import type { FileContent } from '../knowledgeBaseQA';
import { previewLongFileContent } from './file';

export interface KnowledgeBaseInfo {
  description?: string | null;
  id: string;
  name: string;
}

export interface PromptKnowledgeOptions {
  /** File contents to inject */
  fileContents?: FileContent[];
  /** Knowledge bases to include */
  knowledgeBases?: KnowledgeBaseInfo[];
}

/**
 * Formats a single file content with XML tags
 */
const formatFileContent = (file: FileContent): string => {
  if (file.error) {
    return `<file id="${file.fileId}" name="${file.filename}" error="${file.error}" />`;
  }

  // Agent files are re-sent on every turn, so oversized ones get the same preview as attachments.
  const { attributes, body } = previewLongFileContent(file.content, {
    fileId: file.fileId,
    originalChars: file.originalChars,
  });
  return `<file id="${file.fileId}" name="${file.filename}"${attributes}>
${body}
</file>`;
};

/**
 * Format agent knowledge (files + knowledge bases) as unified XML prompt
 */
export const promptAgentKnowledge = ({
  fileContents = [],
  knowledgeBases = [],
}: PromptKnowledgeOptions) => {
  const hasFiles = fileContents.length > 0;
  const hasKnowledgeBases = knowledgeBases.length > 0;

  // If no knowledge at all, return empty
  if (!hasFiles && !hasKnowledgeBases) {
    return '';
  }

  const contentParts: string[] = [];

  // Add instruction based on what's available
  if (hasFiles && hasKnowledgeBases) {
    contentParts.push(
      '<instruction>The following files and knowledge bases are available. For files, refer to their content directly. For knowledge bases, use the searchKnowledgeBase tool to find relevant information.</instruction>',
    );
  } else if (hasFiles) {
    contentParts.push(
      '<instruction>The following files are available. Refer to their content directly to answer questions. No knowledge bases are associated.</instruction>',
    );
  } else {
    contentParts.push(
      '<instruction>The following knowledge bases are available for semantic search. Use the searchKnowledgeBase tool to find relevant information.</instruction>',
    );
  }

  // Add files section
  if (hasFiles) {
    const filesXml = fileContents.map((file) => formatFileContent(file)).join('\n');
    contentParts.push(`<files totalCount="${fileContents.length}">
${filesXml}
</files>`);
  }

  // Add knowledge bases section
  if (hasKnowledgeBases) {
    const kbItems = knowledgeBases
      .map(
        (kb) =>
          `<knowledge_base id="${kb.id}" name="${kb.name}"${kb.description ? ` description="${kb.description}"` : ''} />`,
      )
      .join('\n');
    contentParts.push(`<knowledge_bases totalCount="${knowledgeBases.length}">
${kbItems}
</knowledge_bases>`);
  }

  return `<agent_knowledge>
${contentParts.join('\n')}
</agent_knowledge>`;
};
