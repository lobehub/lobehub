import { unzip } from 'fflate';

import { SkillParseError } from './errors';

export interface GitHubSkillDirectory {
  markdown: string;
  resources: Map<string, Buffer>;
}

const ignored = new Set(['.git', 'node_modules', '__MACOSX']);

export async function readGitHubArchive(buffer: Buffer, basePath: string | string[] = '') {
  const pathsToRead = Array.isArray(basePath) ? basePath : [basePath];
  let count = 0;
  let size = 0;
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(
      buffer,
      {
        filter(entry) {
          if (++count > 50_000)
            throw new SkillParseError('Repository exceeds the file-count limit');
          const relative = entry.name.slice(entry.name.indexOf('/') + 1);
          if (!pathsToRead.some((path) => !path || relative.startsWith(path + '/'))) return false;
          size += entry.originalSize;
          if (size > 128 * 1024 * 1024)
            throw new SkillParseError('Repository exceeds the archive scan limit');
          const parts = entry.name.split('/');
          return (
            !entry.name.endsWith('/') &&
            !parts.some((part) => ignored.has(part) || !part || part === '..' || part === '.')
          );
        },
      },
      (error, data) => (error ? reject(error) : resolve(data)),
    );
  });

  // GitHub adds one wrapper directory. Also support plain skill ZIPs for the
  // single-package parser when its caller requests a repacked download.
  const paths = Object.keys(files);
  const firstDirectory = paths[0]?.split('/')[0] + '/';
  const prefix = paths.every((path) => path.startsWith(firstDirectory)) ? firstDirectory : '';
  const skills = new Map<string, GitHubSkillDirectory>();
  for (const path of paths) {
    if (path.split('/').at(-1) !== 'SKILL.md') continue;
    if (skills.size >= 200)
      throw new SkillParseError('Repository exceeds the 200 skill scan limit');
    const relative = path.slice(prefix.length);
    skills.set(relative.split('/').slice(0, -1).join('/'), {
      markdown: new TextDecoder().decode(files[path]),
      resources: new Map(),
    });
  }
  for (const path of paths) {
    const relative = path.slice(prefix.length);
    const parts = relative.split('/');
    if (parts.pop() === 'SKILL.md') continue;
    // The nearest enclosing SKILL.md owns this resource.
    while (true) {
      const directory = parts.join('/');
      const skill = skills.get(directory);
      if (skill) {
        const key = directory ? relative.slice(directory.length + 1) : relative;
        const bytes = files[path];
        skill.resources.set(key, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
        break;
      }
      if (!parts.length) break;
      parts.pop();
    }
  }
  return skills;
}
