import { execFile } from 'node:child_process';
import { readdir, readFile, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Find the TCP ports this machine is listening on that a tunnel could reach,
 * and which of them belong to a given project — so the UI can offer "5173 ·
 * vite" instead of asking the user to remember a port number.
 *
 * Only loopback or wildcard binds are reported: a tunnel dials `127.0.0.1` (or
 * `::1`), so a server bound to one LAN address only is unreachable anyway.
 * Parsing is split from collection so every platform's format is testable on
 * any platform.
 */

export interface ListenEntry {
  /** Address exactly as the OS reported it, e.g. `*`, `127.0.0.1`, `::1`. */
  address: string;
  command?: string;
  pid?: number;
  port: number;
}

export type LoopbackFamily = 'both' | 'ipv4' | 'ipv6';

export interface ListeningPort {
  command?: string;
  cwd?: string;
  /** The listening process runs inside the requested project directory. */
  inProject: boolean;
  /** Which loopback address reaches it — `ipv6` means `::1` only. */
  loopback: LoopbackFamily;
  pid?: number;
  port: number;
}

export interface ListListeningPortsParams {
  /** Project directory; ports whose process runs inside it are marked `inProject`. */
  cwd?: string;
}

export interface ListListeningPortsResult {
  ports: ListeningPort[];
  /** False when this platform's detector isn't available (e.g. no `lsof`). */
  supported: boolean;
}

const MAX_PORTS = 50;
const COMMAND_TIMEOUT_MS = 5000;

// ─── Address classification ───

type AddressKind = 'any' | 'ipv4-loopback' | 'ipv6-loopback' | 'unreachable';

export const classifyAddress = (address: string): AddressKind => {
  const bare = address.replaceAll(/^\[|\]$/g, '');
  if (bare === '*' || bare === '0.0.0.0' || bare === '::' || bare === '::0') return 'any';
  if (bare.startsWith('127.')) return 'ipv4-loopback';
  if (bare === '::1' || bare === '::ffff:127.0.0.1') return 'ipv6-loopback';
  return 'unreachable';
};

// ─── macOS / BSD: lsof ───

/** Parse `lsof -nP -iTCP -sTCP:LISTEN -F pcn` field output. */
export const parseLsofListen = (output: string): ListenEntry[] => {
  const entries: ListenEntry[] = [];
  let pid: number | undefined;
  let command: string | undefined;

  for (const line of output.split('\n')) {
    const tag = line[0];
    const value = line.slice(1);
    if (tag === 'p') {
      pid = Number(value);
      command = undefined;
    } else if (tag === 'c') {
      command = value;
    } else if (tag === 'n') {
      const sep = value.lastIndexOf(':');
      const port = Number(value.slice(sep + 1));
      if (sep > 0 && Number.isInteger(port) && port > 0) {
        entries.push({ address: value.slice(0, sep), command, pid, port });
      }
    }
  }
  return entries;
};

/** Parse `lsof -a -p <pids> -d cwd -Fpn` into pid → cwd. */
export const parseLsofCwd = (output: string): Map<number, string> => {
  const cwds = new Map<number, string>();
  let pid: number | undefined;
  for (const line of output.split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1));
    else if (line[0] === 'n' && pid !== undefined) cwds.set(pid, line.slice(1));
  }
  return cwds;
};

// ─── Linux: /proc/net/tcp{,6} ───

const LISTEN_STATE = '0A';

const decodeProcIpv4 = (hex: string) =>
  [hex.slice(6, 8), hex.slice(4, 6), hex.slice(2, 4), hex.slice(0, 2)]
    .map((byte) => Number.parseInt(byte, 16))
    .join('.');

const decodeProcIpv6 = (hex: string): string => {
  if (/^0+$/.test(hex)) return '::';
  if (hex === '00000000000000000000000001000000') return '::1';
  if (hex === '0000000000000000FFFF00000100007F') return '::ffff:127.0.0.1';
  return hex; // any other v6 bind is unreachable over loopback; keep it opaque
};

/** Parse `/proc/net/tcp` or `/proc/net/tcp6` into listening sockets keyed by inode. */
export const parseProcNetTcp = (
  content: string,
  family: 'v4' | 'v6',
): Array<{ address: string; inode: string; port: number }> =>
  content
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length > 9 && cols[3] === LISTEN_STATE)
    .map((cols) => {
      const [addrHex, portHex] = cols[1].split(':');
      return {
        address: family === 'v4' ? decodeProcIpv4(addrHex) : decodeProcIpv6(addrHex.toUpperCase()),
        inode: cols[9],
        port: Number.parseInt(portHex, 16),
      };
    });

// ─── Windows: netstat ───

/** Parse `netstat -ano -p TCP` / `-p TCPv6` LISTENING rows. */
export const parseNetstat = (output: string): ListenEntry[] =>
  output
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols[0] === 'TCP' && cols[3] === 'LISTENING')
    .map((cols) => {
      const local = cols[1];
      const sep = local.lastIndexOf(':');
      return {
        address: local.slice(0, sep),
        pid: Number(cols[4]),
        port: Number(local.slice(sep + 1)),
      };
    });

/** Parse `tasklist /FO CSV /NH` into pid → image name. */
export const parseTasklist = (output: string): Map<number, string> => {
  const names = new Map<number, string>();
  for (const line of output.split('\n')) {
    const cols = line.match(/"([^"]*)"/g)?.map((col) => col.slice(1, -1));
    if (cols && cols.length > 1) names.set(Number(cols[1]), cols[0]);
  }
  return names;
};

// ─── Assembly ───

const isInside = (dir: string | undefined, root: string | undefined) => {
  if (!dir || !root) return false;
  const rel = path.relative(path.resolve(root), path.resolve(dir));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/**
 * Fold raw sockets into one row per port, keep only loopback-reachable ones,
 * drop this process's own listeners, and put the project's ports first.
 */
export const summarizeListeners = (
  entries: ListenEntry[],
  options: { cwd?: string; cwds?: Map<number, string>; ownPid?: number },
): ListeningPort[] => {
  const byPort = new Map<number, { entry: ListenEntry; kinds: Set<AddressKind> }>();

  for (const entry of entries) {
    if (options.ownPid !== undefined && entry.pid === options.ownPid) continue;
    const kind = classifyAddress(entry.address);
    if (kind === 'unreachable') continue;
    const existing = byPort.get(entry.port);
    if (existing) existing.kinds.add(kind);
    else byPort.set(entry.port, { entry, kinds: new Set([kind]) });
  }

  const ports = [...byPort.values()].map(({ entry, kinds }) => {
    const v4 = kinds.has('any') || kinds.has('ipv4-loopback');
    const v6 = kinds.has('any') || kinds.has('ipv6-loopback');
    const cwd = entry.pid === undefined ? undefined : options.cwds?.get(entry.pid);
    return {
      ...(entry.command ? { command: entry.command } : {}),
      ...(cwd ? { cwd } : {}),
      inProject: isInside(cwd, options.cwd),
      loopback: (v4 && v6 ? 'both' : v4 ? 'ipv4' : 'ipv6') as LoopbackFamily,
      ...(entry.pid === undefined ? {} : { pid: entry.pid }),
      port: entry.port,
    };
  });

  return ports
    .sort((a, b) => Number(b.inProject) - Number(a.inProject) || a.port - b.port)
    .slice(0, MAX_PORTS);
};

const run = async (file: string, args: string[]) =>
  (await execFileAsync(file, args, { maxBuffer: 4 * 1024 * 1024, timeout: COMMAND_TIMEOUT_MS }))
    .stdout;

const collectDarwin = async () => {
  // lsof exits 1 when nothing matches; that is an empty list, not a failure.
  const listen = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcn']).catch(
    (error: { code?: number | string; stdout?: string }) => {
      if (error.code === 1) return error.stdout ?? '';
      throw error;
    },
  );
  const entries = parseLsofListen(listen);
  const pids = [...new Set(entries.map((e) => e.pid).filter((p): p is number => !!p))];
  const cwds = pids.length
    ? parseLsofCwd(
        await run('lsof', ['-a', '-p', pids.join(','), '-d', 'cwd', '-Fpn']).catch(
          (error: { stdout?: string }) => error.stdout ?? '',
        ),
      )
    : new Map<number, string>();
  return { cwds, entries };
};

const collectLinux = async () => {
  const sockets = [
    ...parseProcNetTcp(await readFile('/proc/net/tcp', 'utf8').catch(() => ''), 'v4'),
    ...parseProcNetTcp(await readFile('/proc/net/tcp6', 'utf8').catch(() => ''), 'v6'),
  ];
  const wanted = new Set(sockets.map((s) => s.inode));
  const owner = new Map<string, number>();

  // Map socket inodes back to processes. Only this user's processes are
  // readable, which is exactly the set a tunnel should offer.
  for (const pidDir of await readdir('/proc').catch(() => [] as string[])) {
    if (!/^\d+$/.test(pidDir)) continue;
    const fds = await readdir(`/proc/${pidDir}/fd`).catch(() => [] as string[]);
    for (const fd of fds) {
      const target = await readlink(`/proc/${pidDir}/fd/${fd}`).catch(() => '');
      const inode = /^socket:\[(\d+)\]$/.exec(target)?.[1];
      if (inode && wanted.has(inode)) owner.set(inode, Number(pidDir));
    }
  }

  const cwds = new Map<number, string>();
  const commands = new Map<number, string>();
  for (const pid of new Set(owner.values())) {
    const cwd = await readlink(`/proc/${pid}/cwd`).catch(() => undefined);
    if (cwd) cwds.set(pid, cwd);
    const comm = await readFile(`/proc/${pid}/comm`, 'utf8').catch(() => undefined);
    if (comm) commands.set(pid, comm.trim());
  }

  const entries: ListenEntry[] = sockets.map((socket) => {
    const pid = owner.get(socket.inode);
    return {
      address: socket.address,
      ...(pid === undefined ? {} : { command: commands.get(pid), pid }),
      port: socket.port,
    };
  });
  return { cwds, entries };
};

const collectWindows = async () => {
  const [v4, v6, tasks] = await Promise.all([
    run('netstat', ['-ano', '-p', 'TCP']),
    run('netstat', ['-ano', '-p', 'TCPv6']),
    run('tasklist', ['/FO', 'CSV', '/NH']).catch(() => ''),
  ]);
  const names = parseTasklist(tasks);
  // Windows exposes no cheap per-process cwd, so nothing is marked in-project.
  const entries = [...parseNetstat(v4), ...parseNetstat(v6)].map((entry) => ({
    ...entry,
    command: entry.pid === undefined ? undefined : names.get(entry.pid),
  }));
  return { cwds: new Map<number, string>(), entries };
};

export const listListeningPorts = async (
  params: ListListeningPortsParams = {},
): Promise<ListListeningPortsResult> => {
  const collect =
    process.platform === 'darwin'
      ? collectDarwin
      : process.platform === 'linux'
        ? collectLinux
        : process.platform === 'win32'
          ? collectWindows
          : undefined;
  if (!collect) return { ports: [], supported: false };

  try {
    const { cwds, entries } = await collect();
    // The OS reports resolved paths (macOS `/tmp` → `/private/tmp`), so the
    // project root has to be resolved the same way before comparing.
    const cwd = params.cwd ? await realpath(params.cwd).catch(() => params.cwd) : undefined;
    return {
      ports: summarizeListeners(entries, { cwd, cwds, ownPid: process.pid }),
      supported: true,
    };
  } catch {
    // e.g. `lsof` missing: say so, so the UI can fall back to manual entry.
    return { ports: [], supported: false };
  }
};
