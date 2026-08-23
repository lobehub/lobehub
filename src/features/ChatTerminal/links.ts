import debug from 'debug';

import { electronSystemService } from '@/services/electron/system';

const log = debug('lobe-desktop:chat-terminal');

// The main process hands this straight to shell.openExternal, and terminal
// output is attacker-reachable — any command can print an escape sequence. So
// the renderer is the gate: only http(s) ever reaches the OS handler.
const OPENABLE_PROTOCOLS = new Set(['http:', 'https:']);

export const openTerminalLink = (uri: string) => {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    log('ignoring unparseable terminal link: %s', uri);
    return;
  }

  if (!OPENABLE_PROTOCOLS.has(parsed.protocol)) {
    log('ignoring terminal link with unsupported protocol: %s', parsed.protocol);
    return;
  }

  void electronSystemService.openExternalLink(parsed.href).catch((error) => {
    log('failed to open terminal link %s: %O', parsed.href, error);
  });
};
