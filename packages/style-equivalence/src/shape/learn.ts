import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Browser } from '@playwright/test';

import { buildSide } from '../build/viteBuild';
import { serveDirectories } from '../capture/staticServer';
import type { ProjectConfig } from '../config';
import { HOST_HTML } from '../generate/host';
import type { ShapeBook } from '../plan/shapes';
import { bookOf, mergeWidths, type ShapeReading } from './book';
import { readShapesInPage } from './inPage';
import { generateProbeEntry, SHAPE_CLASS, SHAPE_SLOT_PREFIX } from './probe';
import type { ShapeRequest } from './requests';

export const SHAPE_HOST_DIR = '.style-equivalence-shapes';

type Side = 'base' | 'head';

export interface LearnOptions {
  browser: Browser;
  config: ProjectConfig;
  configDir: string;
  configFile: string;
  requests: ShapeRequest[];
  roots: Record<Side, string>;
  runDir: string;
}

const READ = `(() => {
  const __name = (target) => target;
  return (${readShapesInPage.toString()})(${JSON.stringify({ className: SHAPE_CLASS, slotPrefix: SHAPE_SLOT_PREFIX })});
})()`;

const buildProbes = async (side: Side, options: LearnOptions) => {
  const host = path.join(options.roots[side], SHAPE_HOST_DIR);
  await rm(host, { force: true, recursive: true });
  await mkdir(host, { recursive: true });
  await writeFile(path.join(host, 'index.html'), HOST_HTML);
  await writeFile(
    path.join(host, 'entry.tsx'),
    generateProbeEntry({
      hostWrapper: path.resolve(options.configDir, options.config.hostWrapper),
      requests: options.requests,
    }),
  );
  const outDir = path.join(options.runDir, `shapes-${side}`);
  try {
    await buildSide({
      configFile: options.configFile,
      hostDir: host,
      logFile: path.join(options.runDir, `build-shapes-${side}.log`),
      outDir,
      root: options.roots[side],
    });
    return outDir;
  } catch (error) {
    await writeFile(
      path.join(options.runDir, `build-shapes-${side}.log`),
      error instanceof Error ? error.message : String(error),
    );
    return undefined;
  }
};

const readAt = async (browser: Browser, url: string, width: number) => {
  const page = await browser.newPage({ viewport: { height: 900, width } });
  try {
    await page.goto(url);
    await page.waitForSelector('[data-synthetic-ready]', { state: 'attached', timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    return (await page.evaluate(READ)) as ShapeReading;
  } finally {
    await page.close();
  }
};

export const learnShapes = async (options: LearnOptions): Promise<ShapeBook> => {
  if (!options.requests.length) return {};
  const dists = await Promise.all(
    (['base', 'head'] as const).map((side) => buildProbes(side, options)),
  );
  const server = await serveDirectories(options.runDir);
  try {
    const sides: Partial<Record<Side, ShapeReading>> = {};
    for (const [index, side] of (['base', 'head'] as const).entries()) {
      const dist = dists[index];
      if (!dist) continue;
      const url = `${server.url}/${path.relative(options.runDir, dist)}/`;
      const readings: ShapeReading[] = [];
      try {
        for (const width of options.config.conditions.widths)
          readings.push(await readAt(options.browser, url, width));
      } catch {
        continue;
      }
      sides[side] = mergeWidths(readings);
    }
    return bookOf(sides);
  } finally {
    await server.close();
  }
};
