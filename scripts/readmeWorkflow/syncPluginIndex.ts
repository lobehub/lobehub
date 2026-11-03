import { consola } from 'consola';
import { markdownTable } from 'markdown-table';
import urlJoin from 'url-join';

import type { DataItem } from './const';
import { PLUGIN_SPLIT } from './const';
import {
  fetchPluginIndex,
  genLink,
  genTags,
  getTitle,
  readReadme,
  updateReadme,
  writeReadme,
} from './utlis';

const genPluginTable = (data: DataItem[], lang?: string) => {
  const title = getTitle(lang);

  const content = data
    .slice(0, 4)
    .map((item) => [
      [
        genLink(
          item.meta.title.replaceAll('|', ','),
          urlJoin('https://lobechat.com/discover/plugin', item.identifier),
        ),
        `<sup>By **${item.author}** on **${item.createdAt}**</sup>`,
      ].join('<br/>'),
      [item.meta.description.replaceAll('|', ','), genTags(item.meta.tags)].join('<br/>'),
    ]);

  return markdownTable([title, ...content]);
};

const runPluginTable = async (lang?: string) => {
  const data = await fetchPluginIndex(lang);
  const md = readReadme(lang);
  const mdTable = genPluginTable(data, lang);
  const newMd = updateReadme(
    PLUGIN_SPLIT,
    md,
    [
      mdTable,
      `> 📊 Total plugins: ${genLink(`<kbd>**${data.length}**</kbd>`, 'https://lobechat.com/discover/plugins')}`,
    ].join('\n\n'),
  );
  writeReadme(newMd, lang);
  consola.success(`Sync ${lang || 'en-US'} plugin index success!`);
};

export default async () => {
  await runPluginTable();
  await runPluginTable('zh-CN');
};
