import { describe, expect, it } from 'vitest';

import { isHeteroExecCommandFor, parseHeteroExecProcesses } from '../heteroExecProcess';

const OP = 'op_1789469228314_agt_wTVg1V72zhow_tpc_hLx07QnXKl3Y_Ft2WdCfP';

describe('heteroExecProcess', () => {
  it('matches the packaged desktop wrapper argv for the operation', () => {
    expect(
      isHeteroExecCommandFor(
        `/Applications/LobeHub.app/Contents/MacOS/LobeHub /Applications/LobeHub.app/Contents/Resources/bin/lobe-cli.js hetero exec --type kimi-code --operation-id ${OP} --topic tpc_hLx07QnXKl3Y --render none --input-json - --cwd /tmp/work`,
        OP,
      ),
    ).toBe(true);
    expect(isHeteroExecCommandFor(`node lh.js hetero exec --operation-id=${OP}`, OP)).toBe(true);
  });

  it('ignores other operations, prefixes and non-exec commands', () => {
    expect(isHeteroExecCommandFor(`lh hetero exec --operation-id ${OP}-2`, OP)).toBe(false);
    expect(isHeteroExecCommandFor(`lh hetero exec --operation-id op_other`, OP)).toBe(false);
    expect(isHeteroExecCommandFor(`lh topic view --operation-id ${OP}`, OP)).toBe(false);
    expect(isHeteroExecCommandFor(`--operation-id ${OP} hetero exec`, OP)).toBe(false);
    expect(isHeteroExecCommandFor('kimi-code', OP)).toBe(false);
    expect(isHeteroExecCommandFor(`lh hetero exec --operation-id ${OP}`, '')).toBe(false);
  });

  it('parses ps output and skips the current process', () => {
    const output = [
      `  85278 /Applications/LobeHub.app/Contents/MacOS/LobeHub lobe-cli.js hetero exec --type kimi-code --operation-id ${OP} --topic t`,
      '  85296 kimi-code    ',
      `    100 node lh.js hetero exec --operation-id ${OP}`,
      '',
    ].join('\n');

    expect(parseHeteroExecProcesses(output, OP, 100)).toEqual([{ pid: 85278 }]);
    expect(parseHeteroExecProcesses(output, 'op_missing', 100)).toEqual([]);
  });
});
