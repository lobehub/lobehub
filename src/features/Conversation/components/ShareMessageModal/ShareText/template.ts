import { type UIChatMessage } from '@lobechat/types';
import { template } from 'es-toolkit/compat';

import { LOADING_FLAT } from '@/const/message';

const markdownTemplate = template(
  `<% messages.forEach(function(chat) { %>

{{chat.content}}

<% }); %>
`,
  {
    evaluate: /<%([\s\S]+?)%>/g,
    interpolate: /\{\{([\s\S]+?)\}\}/g,
  },
);

interface MarkdownParams {
  messages: UIChatMessage[];
}

export const generateMarkdown = ({ messages }: MarkdownParams) =>
  markdownTemplate({
    messages: messages.filter((m) => m.content !== LOADING_FLAT),
  });
