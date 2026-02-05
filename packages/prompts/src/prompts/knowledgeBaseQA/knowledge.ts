import type { KnowledgeItem } from '@lobechat/types';

const knowledgePrompt = (item: KnowledgeItem) =>
  `<knowledge id="${item.id}" name="${item.name}" type="${item.type}"${item.fileType ? ` fileType="${item.fileType}" ` : ''}>${item.description || ''}</knowledge>`;

export const knowledgePrompts = (list?: KnowledgeItem[]) => {
  if ((list || []).length === 0) return '';

  const prompt = `<knowledge_bases>
<knowledge_bases_docstring>here are the knowledge base scope we retrieve chunks from:</knowledge_bases_docstring>
${list?.map((item) => knowledgePrompt(item)).join('\n')}
</knowledge_bases>`;

  return prompt.trim();
};
