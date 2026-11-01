import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { ListHeterogeneousAgentModelsParams } from '@lobechat/types';
import { getHeteroSelectorCapability, HETEROGENEOUS_AGENT_CONFIGS } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as cliSpawn from '../spawn/cliSpawn';
import { listHeterogeneousAgentModels } from './listHeterogeneousAgentModels';

// Only replace the external CLI executable. Use real child processes and cwd handling.
const resolveCliSpawnPlan = cliSpawn.resolveCliSpawnPlan;

describe('model discovery working directory', () => {
  let root: string;
  let project: string;
  const catalogTypes = HETEROGENEOUS_AGENT_CONFIGS.filter(
    ({ type }) => getHeteroSelectorCapability(type)?.model?.source === 'catalog',
  ).map(({ type }) => type) as ListHeterogeneousAgentModelsParams['type'][];

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'hetero-model-cwd-'));
    project = path.join(root, 'project');
    await mkdir(project);
    await writeFile(path.join(root, 'file'), 'not a directory');
    const fixture = path.join(root, 'catalog.cjs');
    await writeFile(
      fixture,
      String.raw`const engine = process.argv[2];
const model = process.cwd() === ${JSON.stringify(project)} ? 'project-model' : 'host-model';
if (['codex', 'droid', 'trae'].includes(engine)) {
  require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
    const message = JSON.parse(line);
    if (message.id === undefined) return;
    let result = {};
    if (message.method === 'model/list') result = { data: [{ model }], nextCursor: null };
    if (message.method === 'session/new') result = {
      sessionId: 'catalog',
      configOptions: [{ id: 'model', type: 'select', options: [{ value: model }] }],
    };
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
  });
} else {
  const outputs = {
    codebuddy: '--model <model> Currently supported: (' + model + ')',
    cursor: model + ' - Fixture',
    devin: JSON.stringify({ families: [{ variants: [{ model_uid: model }] }] }),
    'grok-build': model + '  Fixture',
    'kimi-code': JSON.stringify({ models: { [model]: { model } } }),
    opencode: 'fixture/' + model,
    pi: 'fixture  ' + model + '  128K  16K  yes  yes',
    qoder: model,
  };
  process.stdout.write(outputs[engine] + '\n');
}
`,
    );
    vi.spyOn(cliSpawn, 'resolveCliSpawnPlan').mockImplementation((command, args) =>
      path.dirname(command) === root &&
      catalogTypes.includes(path.basename(command) as (typeof catalogTypes)[number])
        ? Promise.resolve({
            args: [fixture, path.basename(command), ...args],
            command: process.execPath,
          })
        : resolveCliSpawnPlan(command, args),
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { force: true, recursive: true });
  });

  describe.each(catalogTypes)('%s', (type) => {
    it.each(['missing', 'file'])(
      'discovers models when the configured cwd is a %s path',
      async (name) => {
        const result = await listHeterogeneousAgentModels({
          command: path.join(root, type),
          cwd: path.join(root, name),
          type,
        });

        expect(result).toMatchObject({ models: [{ modelId: 'host-model' }], status: 'success' });
      },
    );

    it('keeps a valid project cwd so project configuration still applies', async () => {
      const result = await listHeterogeneousAgentModels({
        command: path.join(root, type),
        cwd: project,
        type,
      });

      expect(result).toMatchObject({ models: [{ modelId: 'project-model' }], status: 'success' });
    });

    it('still reports a missing executable rather than hiding it with the cwd fallback', async () => {
      const result = await listHeterogeneousAgentModels({
        command: path.join(root, 'missing-cli'),
        cwd: path.join(root, 'missing'),
        type,
      });

      expect(result).toMatchObject({ error: { code: 'cli_not_found' }, status: 'error' });
    });
  });

  it('falls back after resolving an unusable Codex --cd override', async () => {
    const result = await listHeterogeneousAgentModels({
      args: ['--cd', 'missing'],
      command: path.join(root, 'codex'),
      cwd: project,
      type: 'codex',
    });

    expect(result).toMatchObject({ models: [{ modelId: 'host-model' }], status: 'success' });
  });

  it('keeps a valid Codex --cd override even when the original cwd is missing', async () => {
    const result = await listHeterogeneousAgentModels({
      args: ['--cd', project],
      command: path.join(root, 'codex'),
      cwd: path.join(root, 'missing'),
      type: 'codex',
    });

    expect(result).toMatchObject({ models: [{ modelId: 'project-model' }], status: 'success' });
  });
});
