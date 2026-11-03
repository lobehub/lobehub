import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkHtml from 'remark-html';

export const parseMarkdown = async (content: string) => {
  const file = await remark().use(remarkGfm).use(remarkHtml).process(content.trim());

  return String(file);
};
