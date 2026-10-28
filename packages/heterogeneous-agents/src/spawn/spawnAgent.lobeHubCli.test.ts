import type * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildHeterogeneousPrompt, lobeHubCliGuide } from '../protocol';
import { spawnAgent } from './spawnAgent';

const spawnCalls: Array<{ args: string[]; command: string }> = [];
let nextFakeProc: any = null;

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof childProcess>('node:child_process');
  return {
    ...actual,
    spawn: vi.fn((command: string, args: string[]) => {
      spawnCalls.push({ args, command });
      return nextFakeProc;
    }),
  };
});

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof os>('node:os');
  return { ...actual, platform: vi.fn(() => 'linux') };
});

/** A one-shot Claude Code child that records what it was sent on stdin. */
const createProc = () => {
  const proc = new EventEmitter() as any;
  const stdinWrites: string[] = [];
  proc.stdin = {
    end: vi.fn(),
    once: vi.fn(),
    write: vi.fn((chunk: string, cb?: () => void) => {
      stdinWrites.push(chunk);
      cb?.();
      return true;
    }),
  };
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();
  proc.pid = 4321;
  return {
    exit: () => {
      proc.stdout.end();
      proc.stderr.end();
      proc.emit('exit', 0, null);
    },
    proc,
    userContent: () => JSON.parse(stdinWrites[0]).message.content,
  };
};

const run = async (options: Partial<Parameters<typeof spawnAgent>[0]>) => {
  const fake = createProc();
  nextFakeProc = fake.proc;
  const handle = await spawnAgent({
    agentType: 'claude-code',
    // What `lh hetero exec` passes on from its validated `claude --version`.
    commandVersion: '2.1.301',
    operationId: 'op-1',
    prompt: 'hello',
    ...options,
  });
  const drained = (async () => {
    for await (const _event of handle.events);
  })();
  fake.exit();
  await drained;
  return { args: spawnCalls[0].args, userContent: fake.userContent() };
};

const pluginDirArg = (args: string[]) => {
  const index = args.indexOf('--plugin-dir');
  return index === -1 ? undefined : args[index + 1];
};

// The dispatcher's own first-turn prompt: the guide, then the user's request.
const userRequest =
  'Look at openclaw session 5a8fe152b3cc4537ba69af868b133cc1 — why does the browser fail?';
const firstTurnPrompt = buildHeterogeneousPrompt({ isNewSession: true, prompt: userRequest });

describe('spawnAgent — LobeHub CLI guide for Claude Code', () => {
  let tempRoot: string;
  const originalTmpdir = process.env.TMPDIR;

  beforeEach(async () => {
    spawnCalls.length = 0;
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lobehub-cli-spawn-'));
    process.env.TMPDIR = tempRoot;
  });

  afterEach(async () => {
    nextFakeProc = null;
    if (originalTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = originalTmpdir;
    await rm(tempRoot, { force: true, recursive: true });
  });

  /**
   * Regression (lobehub/lobehub#20675): the guide was prepended to the user's
   * message, persisted in the CLI's transcript as words the user said, and
   * read as the task — the agent went looking for LobeHub topics instead of
   * answering.
   */
  it("loads the guide as a skill and keeps it out of the user's turn", async () => {
    const { args, userContent } = await run({
      env: { LOBEHUB_TOPIC_ID: 'tpc_1' },
      prompt: firstTurnPrompt,
    });

    expect(userContent).toEqual([{ text: userRequest, type: 'text' }]);
    const pluginDir = pluginDirArg(args);
    expect(pluginDir).toBeDefined();
    const skill = await readFile(path.join(pluginDir!, 'skills/lobehub/SKILL.md'), 'utf8');
    expect(skill).toContain('`LOBEHUB_TOPIC_ID` (this conversation)');
  });

  it('loads the skill on a resumed turn, which carries no in-message copy', async () => {
    const { args } = await run({
      env: { LOBEHUB_TOPIC_ID: 'tpc_1' },
      prompt: buildHeterogeneousPrompt({ isNewSession: false, prompt: 'carry on' }),
      resumeSessionId: 'cc-session',
    });

    expect(pluginDirArg(args)).toBeDefined();
  });

  it('leaves a run outside any LobeHub conversation untouched', async () => {
    const { args, userContent } = await run({ prompt: firstTurnPrompt });

    expect(pluginDirArg(args)).toBeUndefined();
    expect(userContent[0]).toEqual({ text: lobeHubCliGuide, type: 'text' });
  });

  it('keeps the guide in the prompt for a Claude Code that predates plugin skills', async () => {
    const { args, userContent } = await run({
      commandVersion: '2.0.11',
      env: { LOBEHUB_TOPIC_ID: 'tpc_1' },
      prompt: firstTurnPrompt,
    });

    expect(pluginDirArg(args)).toBeUndefined();
    expect(userContent[0]).toEqual({ text: lobeHubCliGuide, type: 'text' });
  });

  it('keeps the guide in the prompt when skills are disabled for the run', async () => {
    const { args, userContent } = await run({
      env: { LOBEHUB_TOPIC_ID: 'tpc_1' },
      extraArgs: ['--disable-slash-commands'],
      prompt: firstTurnPrompt,
    });

    expect(pluginDirArg(args)).toBeUndefined();
    expect(userContent.map((block: { text: string }) => block.text)).toEqual([
      lobeHubCliGuide,
      userRequest,
    ]);
  });
});
