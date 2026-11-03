import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { kebabCase } from 'es-toolkit/compat';

import { AGENT_I18N_URL, AGENT_URL, PLUGIN_I18N_URL, PLUGIN_URL, root } from './const';

const fetchIndex = async (url: string) => {
  const res = await fetch(url);
  return await res.json();
};

export const fetchAgentIndex = async (lang?: string) => {
  const url = lang ? AGENT_I18N_URL(lang) : AGENT_URL;
  const data = await fetchIndex(url);
  return data.agents;
};

export const fetchPluginIndex = async (lang?: string) => {
  const url = lang ? PLUGIN_I18N_URL(lang) : PLUGIN_URL;
  const data = await fetchIndex(url);
  return data.plugins;
};

export const genLink = (title: string, url: string) => `[${title}](${url})`;

export const genTags = (tags: string[]) =>
  tags
    .filter(Boolean)
    .map((tag) => `\`${kebabCase(tag)}\``)
    .join(' ');

const getReadmePath = (lang?: string) => {
  return resolve(root, lang ? `./README.${lang}.md` : `./README.md`);
};

export const readReadme = (lang?: string): string => {
  return readFileSync(getReadmePath(lang), 'utf8');
};

export const writeReadme = (content: string, lang?: string) => {
  writeFileSync(getReadmePath(lang), content, 'utf8');
};

export const updateReadme = (split: string, md: string, content: string): string => {
  const mds = md.split(split);
  mds[1] = [' ', content, ' '].join('\n\n');

  return mds.join(split);
};

export const getTitle = (lang?: string) => {
  switch (lang) {
    case 'zh-CN': {
      return ['最近新增', '描述'];
    }
    case 'ja-JP': {
      return ['最近追加', '説明'];
    }
    default: {
      return ['Recent Submits', 'Description'];
    }
  }
};
