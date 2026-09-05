// @vitest-environment node
/**
 * T-331 端到端链路验证：模拟服务端 resolveAttachments → DocumentService.parseFile
 * 所走的 @lobechat/file-loaders loadFile 路径，验证真实 .v/.sv 文件内容能被完整提取。
 * 这是附件内容进入模型上下文（filesPrompts）的前置环节。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadFile } from '@lobechat/file-loaders';
import { afterAll, describe, expect, it } from 'vitest';

import { isTextReadableFile } from '../src/utils/isTextReadableFile';

describe('T-331 E2E: loadFile extracts .v/.sv content for model context', () => {
  const dir = mkdtempSync(join(tmpdir(), 't331-e2e-'));

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('extracts full content from a real .v file', async () => {
    const filePath = join(dir, 'adder.v');
    writeFileSync(
      filePath,
      `module adder (
  input  wire [3:0] a,
  input  wire [3:0] b,
  output wire [3:0] sum
);
  assign sum = a + b;
endmodule
`,
    );

    const doc = await loadFile(filePath);

    expect(doc.content).toContain('module adder');
    expect(doc.content).toContain('assign sum = a + b;');
    expect(doc.content).toContain('endmodule');
    expect(doc.totalLineCount).toBe(8);
  });

  it('extracts full content from a real .sv file', async () => {
    const filePath = join(dir, 'alu_top.sv');
    writeFileSync(
      filePath,
      `package alu_pkg;
  typedef enum logic [1:0] { OP_ADD, OP_SUB } op_t;
endpackage

module alu_top import alu_pkg::*; (
  input  logic [7:0] a,
  input  logic [7:0] b,
  output logic [7:0] y
);
  always_comb begin
    unique case (op)
      OP_ADD: y = a + b;
      OP_SUB: y = a - b;
    endcase
  end
endmodule
`,
    );

    const doc = await loadFile(filePath);

    expect(doc.content).toContain('package alu_pkg');
    expect(doc.content).toContain('module alu_top');
    expect(doc.content).toContain('always_comb');
  });

  it('isTextReadableFile gate accepts v/sv (the parseFile dispatch decision)', () => {
    expect(isTextReadableFile('v')).toBe(true);
    expect(isTextReadableFile('sv')).toBe(true);
  });
});
