'use client';

import { RunCommandInspector } from '@lobechat/shared-tool-ui/inspectors';
import type { BuiltinInspectorProps } from '@lobechat/types';
import {
  BookOpen,
  ClipboardCheck,
  Focus,
  Keyboard,
  Monitor,
  MousePointer2,
  ScanLine,
  TextCursorInput,
} from 'lucide-react';

import type { AuvRunCommandParams } from '../../types';

const activityIcons = {
  capture: ScanLine,
  focus: Focus,
  help: BookOpen,
  input: TextCursorInput,
  inspect: Monitor,
  keyboard: Keyboard,
  operate: MousePointer2,
  preview: ClipboardCheck,
};

// Presentation only: this does not validate argv or claim command support.
// Help/dry-run describe inspection even when the named command would send input.
function getActivity(argv: string[] = []): keyof typeof activityIcons {
  const separator = argv.indexOf('--');
  const options = separator < 0 ? argv : argv.slice(0, separator);
  if (options.includes('--help') || options.includes('-h')) return 'help';
  if (options.includes('--dry-run')) return 'preview';
  const command = argv[0] === 'invoke' ? (argv[1] ?? '') : '';
  if (['display.capture', 'window.capture', 'screen.captureRegion'].includes(command))
    return 'capture';
  if (['input.typeText', 'input.pasteText'].includes(command)) return 'input';
  if (['input.key', 'input.keys', 'input.keyboard'].includes(command)) return 'keyboard';
  if (['input.focusText', 'input.axFocusText'].includes(command)) return 'focus';
  if (
    [
      'display.list',
      'window.list',
      'app.probePermissions',
      'window.findText',
      'window.waitForText',
      'screen.findText',
      'screen.waitForText',
    ].includes(command)
  )
    return 'inspect';
  return 'operate';
}

/**
 * Displays a Computer Use action through the shared command inspector.
 * Accepts final/streaming argv and a brief purpose; the enclosing tool header
 * owns failures. A completed label does not claim the UI effect was verified.
 */
export const AuvRunCommandInspector = ({
  args,
  partialArgs,
  pluginState: _pluginState,
  ...props
}: BuiltinInspectorProps<Partial<AuvRunCommandParams>, unknown>) => {
  const argv = args?.argv ?? partialArgs?.argv;
  const activity = getActivity(argv);
  const reasoning = args?.reasoning?.trim() || partialArgs?.reasoning?.trim();
  // Display text only. Preserve whitespace and empty arguments in the fallback;
  // the original tool arguments remain available in the expanded tool details.
  const command = argv?.length
    ? `auv ${argv.map((argument) => (/^[\w./:=+-]+$/.test(argument) ? argument : JSON.stringify(argument))).join(' ')}`
    : '';
  const loading = props.isArgumentsStreaming || props.isLoading;

  return (
    <RunCommandInspector
      {...props}
      args={{ command, description: reasoning }}
      icon={activityIcons[activity]}
      translationKey={`builtins.lobe-computer-use.inspector.${activity}${loading ? '.loading' : ''}`}
    />
  );
};
