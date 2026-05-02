import type { ChatImageItem } from '@lobechat/types';
import { createVisualFileRef } from '@lobechat/types';

const imagePrompt = (
  item: ChatImageItem,
  attachUrl: boolean,
  index: number,
  messageId?: string,
) => {
  const ref = createVisualFileRef({ index, messageId, type: 'image' });

  return attachUrl
    ? `<image ref="${ref}" name="${item.alt}" url="${item.url}"></image>`
    : `<image ref="${ref}" name="${item.alt}"></image>`;
};

export const imagesPrompts = (
  imageList: ChatImageItem[],
  attachUrl: boolean,
  messageId?: string,
) => {
  if (imageList.length === 0) return '';

  const prompt = `<images>
<images_docstring>here are user upload images you can refer to</images_docstring>
${imageList.map((item, index) => imagePrompt(item, attachUrl, index, messageId)).join('\n')}
</images>`;

  return prompt.trim();
};
