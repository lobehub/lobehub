import { createReadStream, existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

import type { Browser } from '@playwright/test';

import { analyzeRun } from '../analyze/diff';
import { launchBrowser } from '../capture/browser';
import { captureRun } from '../capture/runner';
import type { CaptureState } from '../capture/states';
import { resolveInside } from '../capture/staticServer';
import type { ConditionConfig } from '../config';
import { SELF_TEST_FILE } from '../selftest/store';
import {
  ApiError,
  applySignoff,
  caseDetail,
  currentVerdict,
  readSelfTest,
  type StoredRun,
} from './api';
import { createRunSource } from './follow';
import { caseShot, caseSnapshot, parseCombo, parseCondition } from './inspectCase';
import { applyReview, caseReview, reviewPayload } from './review';

const TYPES: Record<string, string> = {
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

export const DEFAULT_UI_DIR = path.resolve(import.meta.dirname, '../../ui/dist');
const MAX_BODY = 1024 * 1024;

const PLACEHOLDER =
  '<!doctype html><meta charset="utf-8"><title>style-equivalence</title><p>The report UI is not built. The API is at <a href="/api/run">/api/run</a>.</p>';

const readBody = (request: IncomingMessage) =>
  new Promise<unknown>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) reject(new ApiError(413, 'BODY_TOO_LARGE'));
      else chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new ApiError(400, 'INVALID_JSON'));
      }
    });
    request.on('error', reject);
  });

const json = (response: ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
};

const sendFile = async (response: ServerResponse, root: string, requestPath: string) => {
  const file = existsSync(root) ? await resolveInside(root, requestPath) : undefined;
  if (!file) return false;
  response.writeHead(200, {
    'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
  });
  createReadStream(file).pipe(response);
  return true;
};

export interface ServerOptions {
  layoutComponents?: string[];
  pin?: boolean;
  port?: number;
  recordsDir?: string;
  runDir: string;
  uiDir?: string;
}

export const startServer = async ({
  layoutComponents = [],
  pin = false,
  port = 0,
  recordsDir,
  runDir,
  uiDir = DEFAULT_UI_DIR,
}: ServerOptions) => {
  const selfTestFile = path.join(recordsDir ?? path.dirname(runDir), SELF_TEST_FILE);
  const source = await createRunSource({
    pin,
    recordsDir: recordsDir ?? path.dirname(runDir),
    runDir,
  });
  let browser: Browser | undefined;
  let url = '';
  const rerun = async (stored: StoredRun, key: string) => {
    browser ??= await launchBrowser();
    const conditions = stored.run.conditionConfig as ConditionConfig | undefined;
    if (!conditions) throw new ApiError(409, 'RUN_HAS_NO_CONDITIONS');
    const cases = encodeURIComponent(JSON.stringify([key]));
    const capture = await captureRun({
      browser,
      conditions,
      states: stored.run.states as CaptureState[] | undefined,
      urls: { base: `${url}/base/#cases=${cases}`, head: `${url}/head/#cases=${cases}` },
    });
    const [result] = analyzeRun(capture);
    if (!result) throw new ApiError(404, `CASE_NOT_RENDERED:${key}`);
    return { result };
  };
  const route = async (request: IncomingMessage, response: ServerResponse) => {
    const { pathname, searchParams } = new URL(request.url ?? '/', 'http://x');
    const method = request.method ?? 'GET';
    const { dir, stored } = await source.current();
    const follow = source.info(stored, dir);
    if (pathname === '/api/current' && method === 'GET') return json(response, 200, follow);
    if (pathname === '/api/run' && method === 'GET')
      return json(response, 200, {
        calibration: stored.calibration,
        cases: stored.results.cases,
        follow,
        mutation: stored.mutation,
        run: stored.run,
        verdict: await currentVerdict(stored),
      });
    if (pathname === '/api/review' && method === 'GET')
      return json(response, 200, { ...(await reviewPayload(stored, layoutComponents)), follow });
    if (pathname === '/api/review' && method === 'POST')
      return json(response, 200, {
        ...(await applyReview(stored, (await readBody(request)) as never)),
        follow,
      });
    if (pathname === '/api/method' && method === 'GET')
      return json(response, 200, { selfTest: await readSelfTest(selfTestFile) });
    const caseMatch = /^\/api\/case\/([^/]+)(?:\/(rerun|review|snapshot|shot))?$/.exec(pathname);
    if (caseMatch) {
      const key = decodeURIComponent(caseMatch[1]);
      const action = caseMatch[2];
      if (action === 'rerun' && method === 'POST')
        return json(response, 200, await rerun(stored, key));
      if (!action && method === 'GET') return json(response, 200, await caseDetail(stored, key));
      if (action === 'review' && method === 'GET')
        return json(response, 200, await caseReview(stored, key, layoutComponents));
      if ((action === 'snapshot' || action === 'shot') && method === 'GET') {
        browser ??= await launchBrowser();
        const inspect = {
          browser,
          combo: parseCombo(searchParams.get('combo')),
          condition: parseCondition(searchParams.get('condition')),
          key,
          url,
        };
        if (action === 'snapshot') return json(response, 200, await caseSnapshot(inspect));
        const side = searchParams.get('side');
        if (side !== 'base' && side !== 'head') throw new ApiError(400, 'INVALID_SIDE');
        const image = await caseShot({
          ...inspect,
          crop: searchParams.get('crop') === '1',
          reveal: searchParams.get('reveal') === '1',
          side,
        });
        response.writeHead(200, { 'cache-control': 'max-age=3600', 'content-type': 'image/png' });
        response.end(image);
        return;
      }
    }
    if (pathname === '/api/signoff' && method === 'POST')
      return json(response, 200, await applySignoff(stored, (await readBody(request)) as never));
    if (pathname.startsWith('/api/')) return json(response, 404, { error: 'NOT_FOUND' });
    for (const [prefix, directory] of [
      ['/base/', 'dist-base'],
      ['/head/', 'dist-head'],
    ] as const)
      if (pathname.startsWith(prefix)) {
        if (
          !(await sendFile(response, path.join(dir, directory), pathname.slice(prefix.length - 1)))
        )
          json(response, 404, { error: 'NOT_FOUND' });
        return;
      }
    if (await sendFile(response, uiDir, pathname)) return;
    if (existsSync(uiDir) && (await sendFile(response, uiDir, '/'))) return;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(PLACEHOLDER);
  };
  const server = createServer((request, response) => {
    route(request, response).catch((error: unknown) => {
      const status = error instanceof ApiError ? error.status : 500;
      json(response, status, { error: error instanceof Error ? error.message : String(error) });
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    stop: async () => {
      await browser?.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    url,
  };
};
