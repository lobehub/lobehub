import { artboardOpSchema } from '@lobechat/types';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerArtboardCommand } from './artboard';

const { output } = vi.hoisted(() => ({ output: vi.fn() }));
vi.mock('../api/client', () => ({ getTrpcClient: vi.fn() }));
vi.mock('../utils/format', () => ({ outputJson: output }));

const run = async (...args: string[]) => {
  const program = new Command().exitOverride();
  registerArtboardCommand(program);
  await program.parseAsync(['node', 'lh', 'artboard', 'ops', ...args]);
};

const opTypes = artboardOpSchema.options.map((option) => option.shape.type.value);

describe('lh artboard ops', () => {
  let printed: string;

  beforeEach(() => {
    printed = '';
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      printed += `${line}\n`;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    output.mockReset();
  });

  it('prints every op the schema accepts with its fields', async () => {
    await run();

    for (const type of opTypes) expect(printed).toContain(`"type": "${type}"`);
    expect(printed).toMatch(
      /"type": "addBoard", "board": \{ "title": string, "x": number, "y": number,/,
    );
    expect(printed).toMatch(/"type": "removeEdge", "id": string/);
  });

  it('marks optional fields and spells out enums and the two board sources', async () => {
    await run();

    expect(printed).toContain('"ref"?: string');
    expect(printed).toContain('"kind": "journey" | "options" | "references" | "other"');
    expect(printed).toContain('{ "kind": "image", "fileRef": string }');
    expect(printed).toContain('{ "kind": "canvas", "canvasId": string,');
  });

  it('warns about the board types and option rules the shapes cannot show', async () => {
    await run();

    expect(printed).toMatch(/"video"[^\n]*refused/);
    expect(printed).toMatch(/"recommended"[^\n]*"roundId"[^\n]*options group/);
  });

  it('prints the JSON Schema with --json', async () => {
    await run('--json');

    const schema = output.mock.calls[0][0];
    expect(schema.oneOf ?? schema.anyOf).toHaveLength(opTypes.length);
  });
});
