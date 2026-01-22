import { ChatAudioItem } from '@lobechat/types';

const audioPrompt = (item: ChatAudioItem, attachUrl: boolean) =>
  attachUrl
    ? `<audio name="${item.alt}" url="${item.url}"></audio>`
    : `<audio name="${item.alt}"></audio>`;

export const audiosPrompts = (audioList: ChatAudioItem[], addUrl: boolean = true) => {
  if (audioList.length === 0) return '';

  const prompt = `<audios>
<audios_docstring>here are user upload audios you can refer to</audios_docstring>
${audioList.map((item) => audioPrompt(item, addUrl)).join('\n')}
</audios>`;

  return prompt.trim();
};
