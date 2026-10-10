import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

interface SourceMap {
  sections?: { map: SourceMap }[];
  sources?: string[];
}
const sources = (map: SourceMap): string[] => [
  ...(map.sources ?? []),
  ...(map.sections ?? []).flatMap((section) => sources(section.map)),
];
const isOriginalLocale = (source: string) =>
  /(?:^|\/)locales\/[^/]+\/[^/]+\.json|packages\/locales\/src\/default\//.test(source);

/** NFT bytes are a local regression budget, not a replacement for Vercel's final package size. */
export const auditFunctionTrace = async (manifest: string) => {
  const { files } = JSON.parse(await readFile(manifest, 'utf8')) as { files: string[] };
  const traced = new Set(
    await Promise.all(
      [
        manifest.replace(/\.nft\.json$/, ''),
        ...files.map((file) => path.resolve(path.dirname(manifest), file)),
      ].map((file) => realpath(file)),
    ),
  );
  let bytes = 0;
  let sourceMaps = 0;
  for (const file of traced) {
    if (isOriginalLocale(file)) throw new Error(`Unprojected locale in NFT: ${file}`);
    if (file.endsWith('/src/libs/i18n/server/generated/report.json'))
      throw new Error(`Build-only i18n report in NFT: ${file}`);
    bytes += (await stat(file)).size;
    if (!file.endsWith('.js')) continue;
    try {
      const map = JSON.parse(await readFile(`${file}.map`, 'utf8')) as SourceMap;
      sourceMaps += 1;
      if (sources(map).some(isOriginalLocale))
        throw new Error(`Unprojected locale embedded in ${file}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return { bytes, files: traced.size, sourceMaps };
};
