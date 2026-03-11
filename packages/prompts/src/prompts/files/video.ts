import type { ChatVideoItem } from '@lobechat/types';

const videoPrompt = (item: ChatVideoItem, attachUrl: boolean) =>
  attachUrl
    ? `<video name="${item.alt}" url="${item.url}"></video>`
    : `<video name="${item.alt}"></video>`;

export const videosPrompts = (videoList: ChatVideoItem[], addUrl: boolean = true) => {
  if (videoList.length === 0) return '';

  const prompt = `<videos>
<videos_docstring>here are user upload videos you can refer to</videos_docstring>
${videoList.map((item) => videoPrompt(item, addUrl)).join('\n')}
</videos>`;

  return prompt.trim();
};
