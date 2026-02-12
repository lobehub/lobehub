import type { ChatSemanticSearchChunk } from '@lobechat/types';

const chunkPrompt = (item: ChatSemanticSearchChunk) =>
  `<chunk fileId="${item.fileId}" fileName="${item.fileName}" similarity="${item.similarity}" ${item.pageNumber ? ` pageNumber="${item.pageNumber}" ` : ''}>${item.text}</chunk>`;

export const chunkPrompts = (fileList: ChatSemanticSearchChunk[]) => {
  if (fileList.length === 0) return '';

  const prompt = `<retrieved_chunks>
<retrieved_chunks_docstring>here are retrived chunks you can refer to:</retrieved_chunks_docstring>
${fileList.map((item) => chunkPrompt(item)).join('\n')}
</retrieved_chunks>`;

  return prompt.trim();
};
