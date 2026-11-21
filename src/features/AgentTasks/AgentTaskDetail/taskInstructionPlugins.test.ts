import { ReactBlockPlugin } from '@lobehub/editor';
import { describe, expect, it } from 'vitest';

import { TASK_INSTRUCTION_EXTRA_PLUGINS } from './taskInstructionPlugins';

describe('TASK_INSTRUCTION_EXTRA_PLUGINS', () => {
  it('mounts the block drag handle so content blocks such as images can be moved by dragging', () => {
    const blockPlugin = TASK_INSTRUCTION_EXTRA_PLUGINS.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === ReactBlockPlugin,
    );

    expect(blockPlugin).toEqual([ReactBlockPlugin, { anchorPadding: 0 }]);
  });
});
