import { relative, resolve } from 'node:path';

import { consola } from 'consola';
import pMap from 'p-map';
import urlJoin from 'url-join';

import { DOCS_DIR, docsFiles, HOME_PATH, SIDEBAR_PATH, WIKI_URL } from './const';
import toc from './toc';
import { genMdLink, getTitle, updateDocs } from './utils';

const run = async () => {
  consola.info(`Find ${docsFiles.length} entry doc files`);
  const docs: any = await pMap(toc, async (item) => {
    const childrenFiles = docsFiles.filter((file) => file.includes(resolve(DOCS_DIR, item.dir)));

    const children: any = await pMap(childrenFiles, async (path) => {
      const paths = {
        cn: path.replace('.md', '.zh-CN.md'),
        en: path,
      };
      const links = {
        cn: urlJoin(
          WIKI_URL,
          relative(DOCS_DIR, paths.cn)
            .replaceAll('\\', '/')
            .split('/')[1]
            .replace('.zh-CN.md', '.zh-CN'),
        ),
        en: urlJoin(
          WIKI_URL,
          relative(DOCS_DIR, paths.en).replaceAll('\\', '/').split('/')[1].replace('.md', ''),
        ),
      };
      const titles = {
        cn: await getTitle(paths.cn),
        en: await getTitle(paths.en),
      };
      return {
        links,
        paths,
        titles,
      };
    });
    return {
      children: children,
      ...item,
    };
  });

  let homeContent = '';
  let sidebarContent = '';

  docs.forEach((item: any) => {
    homeContent += `### ${item.title}\n\n`;
    sidebarContent += `#### ${item.title}\n\n`;
    const data = [...(item.children || []), ...(item.extra || [])];
    data
      .sort((a, b) => {
        if (a.links.en.includes('index')) return -1;
        if (b.links.en.includes('index')) return 1;
        return a.titles.en.localeCompare(b.titles.en);
      })
      .forEach((child: any) => {
        homeContent += `  - ${genMdLink(child.titles.en, child.links.en)} | ${genMdLink(
          child.titles.cn,
          child.links.cn,
        )}\n`;
        sidebarContent += `- ${genMdLink(child.titles.en, child.links.en)} | ${genMdLink(
          child.titles.cn,
          child.links.cn,
        )}\n`;
      });
    homeContent += `\n\n<br/>\n\n`;
    sidebarContent += `\n\n`;
  });

  updateDocs(HOME_PATH, homeContent);
  consola.success(`Update Home.md`);
  updateDocs(SIDEBAR_PATH, sidebarContent);
  consola.success(`Update _Sidebar.md`);
};

run();
