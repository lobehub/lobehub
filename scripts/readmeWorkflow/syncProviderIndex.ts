import { resolve } from 'node:path';

import { consola } from 'consola';
import { readJSONSync } from 'fs-extra';
import urlJoin from 'url-join';

import { PROVIDER_LIST, PROVIDER_SPLIT, root } from './const';
import { genLink, readReadme, updateReadme, writeReadme } from './utlis';

const genProviderTable = (data: { desc?: string; id: string; name: string }) => {
  const title = genLink(data.name, urlJoin('https://lobechat.com/discover/provider', data.id));

  return ['-', `**${title}**:`, data.desc].join(' ');
};

const runProviderTable = async (lang?: string) => {
  const md = readReadme(lang);
  const desc = readJSONSync(resolve(root, 'locales', lang || 'en-US', 'providers.json'));
  const newMd = updateReadme(
    PROVIDER_SPLIT,
    md,
    [
      PROVIDER_LIST.slice(0, 10)
        .map((item) =>
          genProviderTable({
            ...item,
            desc: desc?.[item.id]?.description,
          }),
        )
        .join('\n'),
      `<details><summary><kbd>See more providers (+${PROVIDER_LIST.length - 10})</kbd></summary>`,
      PROVIDER_LIST.slice(10)
        .map((item) =>
          genProviderTable({
            ...item,
            desc: desc?.[item.id]?.description,
          }),
        )
        .join('\n'),
      '</details>',
      `> 📊 Total providers: ${genLink(`<kbd>**${PROVIDER_LIST.length}**</kbd>`, 'https://lobechat.com/discover/providers')}`,
    ].join('\n\n'),
  );
  writeReadme(newMd, lang);
  consola.success(`Sync ${lang || 'en-US'} provider index success!`);
};

export default async () => {
  await runProviderTable();
  await runProviderTable('zh-CN');
};
