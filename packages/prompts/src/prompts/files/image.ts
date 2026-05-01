import type { ChatImageItem } from '@lobechat/types';

const imagePrompt = (item: ChatImageItem, attachUrl: boolean, index: number) =>
  attachUrl
    ? `<image ref="image_${index + 1}" name="${item.alt}" url="${item.url}"></image>`
    : `<image ref="image_${index + 1}" name="${item.alt}"></image>`;

export const imagesPrompts = (imageList: ChatImageItem[], attachUrl: boolean) => {
  if (imageList.length === 0) return '';

  const prompt = `<images>
<images_docstring>here are user upload images you can refer to</images_docstring>
${imageList.map((item, index) => imagePrompt(item, attachUrl, index)).join('\n')}
</images>`;

  return prompt.trim();
};
