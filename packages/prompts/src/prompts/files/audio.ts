import { createVisualFileRef } from '@lobechat/const/visualRef';
import type { ChatAudioItem } from '@lobechat/types';

const audioPrompt = (
  item: ChatAudioItem,
  attachUrl: boolean,
  index: number,
  messageId?: string,
) => {
  const ref = createVisualFileRef({ index, messageId, type: 'audio' });

  return attachUrl
    ? `<audio ref="${ref}" name="${item.alt}" url="${item.url}"></audio>`
    : `<audio ref="${ref}" name="${item.alt}"></audio>`;
};

export const audiosPrompts = (
  audioList: ChatAudioItem[],
  addUrl: boolean = true,
  messageId?: string,
) => {
  if (audioList.length === 0) return '';

  const prompt = `<audios>
<audios_docstring>here are user upload audios you can refer to</audios_docstring>
${audioList.map((item, index) => audioPrompt(item, addUrl, index, messageId)).join('\n')}
</audios>`;

  return prompt.trim();
};
