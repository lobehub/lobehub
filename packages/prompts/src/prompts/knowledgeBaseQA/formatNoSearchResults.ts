import type { KnowledgeBaseSearchIndexStatus } from '@lobechat/types';

import { escapeXmlAttr } from '../search/xmlEscape';

const formatIndexStatus = (status: KnowledgeBaseSearchIndexStatus) =>
  `<index_status embeddedFiles="${status.embeddedFiles}" keywordOnlyItems="${status.keywordOnlyItems}" unindexedFiles="${status.unindexedFiles}" />`;

const formatUnindexedFiles = (status: KnowledgeBaseSearchIndexStatus) => {
  if (status.unindexedFileSamples.length === 0) return '';
  const files = status.unindexedFileSamples
    .map((file) => `<file id="${escapeXmlAttr(file.id)}" name="${escapeXmlAttr(file.name)}" />`)
    .join('\n');
  return `\n<unindexed_files totalCount="${status.unindexedFiles}">\n${files}\n</unindexed_files>`;
};

/** What the model should know about the index when a search that could read something missed. */
const indexNotes = (status: KnowledgeBaseSearchIndexStatus): string[] => {
  const notes: string[] = [];
  if (status.embeddedFiles === 0 && status.keywordOnlyItems > 0) {
    notes.push(
      `None of the ${status.keywordOnlyItems} searchable item(s) has embeddings, so this search matched keywords only: an item is found only when it contains your words. Retry with one or two distinctive words in the items' own language before concluding the content is missing.`,
    );
  }
  if (status.unindexedFiles > 0) {
    notes.push(
      `${status.unindexedFiles} uploaded file(s) are not indexed (never parsed or embedded), so this search could not read them. If readKnowledge is among your available tools, read the files listed below directly.`,
    );
  }
  if (status.embeddedFiles + status.keywordOnlyItems + status.unindexedFiles === 0) {
    notes.push('The searched knowledge bases hold no item this search can read.');
  }
  return notes;
};

/**
 * Format prompt when no search results found using XML structure.
 *
 * @param indexStatus What the searched knowledge bases hold that search can read; adds the notes
 *   that keep the model from reading a keyword-only or partly unindexed library as "not there".
 */
export const promptNoSearchResults = (
  query: string,
  indexStatus?: KnowledgeBaseSearchIndexStatus,
): string => {
  const notes = indexStatus ? indexNotes(indexStatus) : [];
  const indexSection = indexStatus
    ? `\n${formatIndexStatus(indexStatus)}${formatUnindexedFiles(indexStatus)}${
        notes.length > 0
          ? `\n<notes>\n${notes.map((note) => `<note>${note}</note>`).join('\n')}\n</notes>`
          : ''
      }`
    : '';

  return `<knowledge_base_search_results query="${query}" totalCount="0">
<instruction>No relevant files found in the knowledge base for this query.</instruction>${indexSection}
<suggestions>
<suggestion>Try rephrasing your question with different keywords</suggestion>
<suggestion>Check if the information exists in the uploaded documents</suggestion>
<suggestion>Ask the user to provide more context or upload relevant documents</suggestion>
</suggestions>
</knowledge_base_search_results>`;
};

/**
 * Format prompt when the search had no knowledge base to cover at all — the
 * agent (and its task's project, if any) has no enabled knowledge base: none
 * is attached, or every attached one is turned off. Distinct from `promptNoSearchResults` so the model does not read
 * an empty scope as "the content does not exist" (e.g. right after it created
 * a knowledge base and documents that are not attached to this agent).
 */
export const promptNoKnowledgeBaseInScope = (query: string): string => {
  return `<knowledge_base_search_results query="${query}" totalCount="0" searchedKnowledgeBases="0">
<instruction>No enabled knowledge base is in this agent's search scope (none is attached to the agent or its task's project, or the attached ones are turned off), so searchKnowledgeBase had nothing to search. This does NOT mean the content does not exist — knowledge bases and documents you created are not searchable until the knowledge base is attached to this agent and enabled.</instruction>
<suggestions>
<suggestion>If readKnowledge is among your available tools and you already know the document or file IDs (e.g. from createDocument), read them directly</suggestion>
<suggestion>If listKnowledgeBases / viewKnowledgeBase are among your available tools, browse a knowledge base's items there, then read the ones you need</suggestion>
<suggestion>Otherwise, tell the user nothing was searched and ask them to attach the knowledge base to this agent, or turn on the one already attached</suggestion>
</suggestions>
</knowledge_base_search_results>`;
};

/**
 * Format prompt when the searched knowledge bases hold items but none either search path can read:
 * every file is unindexed (never parsed or embedded). Distinct from `promptNoSearchResults` so the
 * model does not read an unbuilt index as "the content does not exist".
 */
export const promptKnowledgeBaseNotIndexed = (
  query: string,
  indexStatus: KnowledgeBaseSearchIndexStatus,
): string => {
  return `<knowledge_base_search_results query="${query}" totalCount="0" status="not_indexed">
<error type="KnowledgeBaseNotIndexed">None of the ${indexStatus.unindexedFiles} file(s) in the searched knowledge bases is indexed (never parsed or embedded), so searchKnowledgeBase could not read any content. This does NOT mean the content is missing.</error>
${formatIndexStatus(indexStatus)}${formatUnindexedFiles(indexStatus)}
<suggestions>
<suggestion>If readKnowledge is among your available tools, read the files listed above directly</suggestion>
<suggestion>If viewKnowledgeBase is among your available tools, list the rest of the knowledge base's files and read the ones you need</suggestion>
<suggestion>Tell the user the knowledge base is not indexed yet, so its files need to be vectorized before search can find them</suggestion>
</suggestions>
</knowledge_base_search_results>`;
};
