import { template } from 'lodash-es';

import { LOADING_FLAT } from '@/const/message';
import { ChatMessage } from '@/types/message';

const markdownTemplate = template(`{{message.content}}`, {
  evaluate: /<%([\S\s]+?)%>/g,
  interpolate: /{{([\S\s]+?)}}/g,
});

interface MarkdownParams {
  message: ChatMessage;
}

export const generateMarkdown = ({ message }: MarkdownParams) => {
  // Filter out loading content
  if (message.content === LOADING_FLAT) {
    return '';
  }

  return markdownTemplate({
    message,
  });
};
