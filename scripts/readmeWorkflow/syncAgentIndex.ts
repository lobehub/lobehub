import { consola } from 'consola';
import { markdownTable } from 'markdown-table';
import urlJoin from 'url-join';

import type { DataItem } from './const';
import { AGENT_SPLIT } from './const';
import {
  fetchAgentIndex,
  genLink,
  genTags,
  getTitle,
  readReadme,
  updateReadme,
  writeReadme,
} from './utlis';

const genAgentTable = (data: DataItem[], lang?: string) => {
  const title = getTitle(lang);

  const content = data
    .slice(0, 4)
    .map((item) => [
      [
        genLink(
          item.meta.title.replaceAll('|', ','),
          urlJoin('https://lobechat.com/discover/assistant', item.identifier),
        ),
        `<sup>By **${genLink(item.author, item.homepage)}** on **${(item as any).createdAt}**</sup>`,
      ].join('<br/>'),
      [item.meta.description.replaceAll('|', ','), genTags(item.meta.tags)].join('<br/>'),
    ]);

  return markdownTable([title, ...content]);
};

const runAgentTable = async (lang?: string) => {
  const data = await fetchAgentIndex(lang);
  const md = readReadme(lang);
  const mdTable = genAgentTable(data, lang);
  const newMd = updateReadme(
    AGENT_SPLIT,
    md,
    [
      mdTable,
      `> 📊 Total agents: ${genLink(`<kbd>**${data.length}**</kbd> `, 'https://lobechat.com/discover/assistants')}`,
    ].join('\n\n'),
  );
  writeReadme(newMd, lang);
  consola.success(`Sync ${lang || 'en-US'} agent index success!`);
};

export default async () => {
  await runAgentTable();
  await runAgentTable('zh-CN');
};
