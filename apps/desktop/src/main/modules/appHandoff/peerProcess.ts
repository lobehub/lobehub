import { execFile } from 'node:child_process';
import { readdir, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** The process on the other end of a loopback connection. */
export interface PeerProcess {
  exePath?: string;
  /** Unknown when the socket is visible but its process is not (another user's process). */
  pid?: number;
  /** True when the process runs as the same OS user as this app. */
  sameUser: boolean;
}

export type RunCommand = (file: string, args: string[]) => Promise<string>;

export const runCommand: RunCommand = async (file, args) => {
  const { stdout } = await execFileAsync(file, args, { timeout: 5000, windowsHide: true });
  return stdout;
};

export interface PeerLookupDeps {
  getuid?: () => number;
  platform?: NodeJS.Platform;
  procRoot?: string;
  run?: RunCommand;
}

// ---------------------------------------------------------------- Linux ----

const TCP_ESTABLISHED = '01';
const TCP_LISTEN = '0A';

interface ProcTcpEntry {
  inode: string;
  localPort: number;
  remotePort: number;
  state: string;
  uid: number;
}

export const parseProcNetTcp = (content: string): ProcTcpEntry[] =>
  content
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= 10)
    .map((cols) => ({
      inode: cols[9],
      localPort: Number.parseInt(cols[1].split(':')[1], 16),
      remotePort: Number.parseInt(cols[2].split(':')[1], 16),
      state: cols[3],
      uid: Number(cols[7]),
    }));

const readProcTcp = async (procRoot: string) => {
  const files = ['net/tcp', 'net/tcp6'];
  const contents = await Promise.all(
    files.map((file) => readFile(path.join(procRoot, file), 'utf8').catch(() => '')),
  );
  return contents.flatMap(parseProcNetTcp);
};

/**
 * Finds the process holding a socket inode. Only this user's processes are
 * readable, which is also the population a same-user check accepts.
 */
const findPidByInode = async (procRoot: string, inode: string) => {
  const target = `socket:[${inode}]`;
  const pids = (await readdir(procRoot)).filter((name) => /^\d+$/.test(name));
  for (const pid of pids) {
    const fdDir = path.join(procRoot, pid, 'fd');
    const fds = await readdir(fdDir).catch(() => [] as string[]);
    for (const fd of fds) {
      const link = await readlink(path.join(fdDir, fd)).catch(() => undefined);
      if (link === target) return Number(pid);
    }
  }
};

const linuxExe = (procRoot: string, pid: number) =>
  readlink(path.join(procRoot, String(pid), 'exe')).catch(() => undefined);

const linuxPeer = async (
  serverPort: number,
  remotePort: number,
  deps: Required<PeerLookupDeps>,
) => {
  const entries = await readProcTcp(deps.procRoot);
  const entry = entries.find(
    (item) =>
      item.state === TCP_ESTABLISHED &&
      item.localPort === remotePort &&
      item.remotePort === serverPort,
  );
  if (!entry) return;

  // The socket table names the owner even when another user's /proc/<pid>/fd is unreadable.
  const sameUser = entry.uid === deps.getuid();
  const pid = sameUser ? await findPidByInode(deps.procRoot, entry.inode) : undefined;

  return { exePath: pid ? await linuxExe(deps.procRoot, pid) : undefined, pid, sameUser };
};

const linuxListener = async (port: number, deps: Required<PeerLookupDeps>) => {
  const entry = (await readProcTcp(deps.procRoot)).find(
    (item) => item.state === TCP_LISTEN && item.localPort === port,
  );
  if (!entry) return;
  const sameUser = entry.uid === deps.getuid();
  return { pid: sameUser ? await findPidByInode(deps.procRoot, entry.inode) : undefined, sameUser };
};

// ---------------------------------------------------------------- macOS ----

/** Parses `lsof -F pun` output into `{ pid, uid, names }` records (one per process). */
export const parseLsofFields = (output: string) => {
  const records: { names: string[]; pid: number; uid?: number }[] = [];
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) records.push({ names: [], pid: Number(line.slice(1)) });
    else if (records.length === 0) continue;
    else if (line.startsWith('u')) records.at(-1)!.uid = Number(line.slice(1));
    else if (line.startsWith('n')) records.at(-1)!.names.push(line.slice(1));
  }
  return records.filter((record) => Number.isInteger(record.pid) && record.pid > 0);
};

const macPeer = async (serverPort: number, remotePort: number, deps: Required<PeerLookupDeps>) => {
  // Match the exact connection seen from the caller's side, not any socket on that port.
  // A non-root lsof does not list other users' sockets: such a caller stays unresolved.
  const output = await deps
    .run('lsof', ['-nP', `-iTCP@127.0.0.1:${remotePort}`, '-sTCP:ESTABLISHED', '-Fpun'])
    .catch(() => '');
  const connection = `127.0.0.1:${remotePort}->127.0.0.1:${serverPort}`;
  const record = parseLsofFields(output).find((item) => item.names.includes(connection));
  if (!record) return;

  const exePath = (
    await deps.run('ps', ['-p', String(record.pid), '-o', 'comm=']).catch(() => '')
  ).trim();
  return {
    exePath: exePath || undefined,
    pid: record.pid,
    sameUser: record.uid === deps.getuid(),
  };
};

const macListener = async (port: number, deps: Required<PeerLookupDeps>) => {
  const output = await deps
    .run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpu'])
    .catch(() => '');
  const record = parseLsofFields(output)[0];
  return record ? { pid: record.pid, sameUser: record.uid === deps.getuid() } : undefined;
};

// -------------------------------------------------------------- Windows ----

const powershell = (deps: Required<PeerLookupDeps>, script: string) =>
  deps.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);

const winPeer = async (serverPort: number, remotePort: number, deps: Required<PeerLookupDeps>) => {
  const script = [
    `$c = Get-NetTCPConnection -State Established -LocalPort ${remotePort} -RemotePort ${serverPort} -ErrorAction SilentlyContinue | Select-Object -First 1`,
    'if (-not $c) { exit 0 }',
    '$p = $c.OwningProcess',
    '$proc = Get-CimInstance Win32_Process -Filter "ProcessId=$p"',
    '$owner = (Invoke-CimMethod -InputObject $proc -MethodName GetOwnerSid).Sid',
    '$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    '@{ pid = $p; exePath = $proc.ExecutablePath; sameUser = ($owner -eq $me) } | ConvertTo-Json -Compress',
  ].join('; ');
  const output = (await powershell(deps, script).catch(() => '')).trim();
  if (!output) return;
  const parsed = JSON.parse(output) as { exePath?: string; pid: number; sameUser: boolean };
  return { exePath: parsed.exePath || undefined, pid: parsed.pid, sameUser: !!parsed.sameUser };
};

const winListener = async (port: number, deps: Required<PeerLookupDeps>) => {
  const script = [
    `$c = Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1`,
    'if (-not $c) { exit 0 }',
    '$p = $c.OwningProcess',
    '$proc = Get-CimInstance Win32_Process -Filter "ProcessId=$p"',
    '$owner = (Invoke-CimMethod -InputObject $proc -MethodName GetOwnerSid).Sid',
    '$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    '@{ pid = $p; sameUser = ($owner -eq $me) } | ConvertTo-Json -Compress',
  ].join('; ');
  const output = (await powershell(deps, script).catch(() => '')).trim();
  if (!output) return;
  const parsed = JSON.parse(output) as { pid: number; sameUser: boolean };
  return { pid: parsed.pid, sameUser: !!parsed.sameUser };
};

// ----------------------------------------------------------------- API -----

const resolveDeps = (deps: PeerLookupDeps): Required<PeerLookupDeps> => ({
  getuid: deps.getuid ?? (() => process.getuid?.() ?? -1),
  platform: deps.platform ?? process.platform,
  procRoot: deps.procRoot ?? '/proc',
  run: deps.run ?? runCommand,
});

/**
 * Resolves the process that opened a connection to this app's `serverPort`
 * from `remotePort` (its source port). `undefined` when the connection cannot
 * be found at all, which the caller refuses.
 */
export const findPeerProcess = async (
  serverPort: number,
  remotePort: number,
  deps: PeerLookupDeps = {},
): Promise<PeerProcess | undefined> => {
  const resolved = resolveDeps(deps);
  try {
    if (resolved.platform === 'linux') return await linuxPeer(serverPort, remotePort, resolved);
    if (resolved.platform === 'darwin') return await macPeer(serverPort, remotePort, resolved);
    if (resolved.platform === 'win32') return await winPeer(serverPort, remotePort, resolved);
  } catch {
    return undefined;
  }
};

export interface ListenerProcess {
  pid?: number;
  sameUser: boolean;
}

/** The process listening on a loopback port, i.e. the owner of a redirect URI. */
export const findListener = async (
  port: number,
  deps: PeerLookupDeps = {},
): Promise<ListenerProcess | undefined> => {
  const resolved = resolveDeps(deps);
  try {
    if (resolved.platform === 'linux') return await linuxListener(port, resolved);
    if (resolved.platform === 'darwin') return await macListener(port, resolved);
    if (resolved.platform === 'win32') return await winListener(port, resolved);
  } catch {
    return undefined;
  }
};
