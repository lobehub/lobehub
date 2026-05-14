import path from 'node:path';

export const getExportMimeType = (filePath: string) => {
  const ext = path.extname(filePath).toLowerCase();

  const map: Record<string, string> = {
    '.bash': 'text/plain; charset=utf-8',
    '.c': 'text/plain; charset=utf-8',
    '.cpp': 'text/plain; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.dockerfile': 'text/plain; charset=utf-8',
    '.fish': 'text/plain; charset=utf-8',
    '.gif': 'image/gif',
    '.go': 'text/plain; charset=utf-8',
    '.graphql': 'application/graphql; charset=utf-8',
    '.h': 'text/plain; charset=utf-8',
    '.hpp': 'text/plain; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'application/javascript; charset=utf-8',
    '.jsx': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.log': 'text/plain; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.mdx': 'text/markdown; charset=utf-8',
    '.mp4': 'video/mp4',
    '.png': 'image/png',
    '.py': 'text/plain; charset=utf-8',
    '.rs': 'text/plain; charset=utf-8',
    '.sh': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.toml': 'application/toml; charset=utf-8',
    '.ts': 'text/plain; charset=utf-8',
    '.tsx': 'text/plain; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.yaml': 'application/yaml; charset=utf-8',
    '.yml': 'application/yaml; charset=utf-8',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.zsh': 'text/plain; charset=utf-8',
  };

  return map[ext];
};
