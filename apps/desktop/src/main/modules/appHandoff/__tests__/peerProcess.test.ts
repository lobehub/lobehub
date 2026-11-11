import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { type AddressInfo, connect, createServer, type Server, type Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { findListener, findPeerProcess, parseLsofFields, parseProcNetTcp } from '../peerProcess';

const PROC_HEADER =
  '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode';
const procLine = (local: number, remote: number, state: string, uid: number, inode: number) =>
  `   0: 0100007F:${local.toString(16).toUpperCase()} 0100007F:${remote.toString(16).toUpperCase()} ${state} 00000000:00000000 00:00000000 00000000  ${uid}        0 ${inode} 1 0000000000000000 20 4 30 10 -1`;

describe('parsers', () => {
  it('reads ports, state, uid and inode from /proc/net/tcp', () => {
    const content = [
      PROC_HEADER,
      procLine(0xd2f0, 0x1f90, '01', 1000, 424242),
      procLine(0x1f90, 0, '0A', 1000, 111),
    ].join('\n');

    expect(parseProcNetTcp(content)).toEqual([
      { inode: '424242', localPort: 0xd2f0, remotePort: 0x1f90, state: '01', uid: 1000 },
      { inode: '111', localPort: 0x1f90, remotePort: 0, state: '0A', uid: 1000 },
    ]);
  });

  it('reads pid, uid and names from lsof -F output', () => {
    expect(parseLsofFields('p321\nu501\nn127.0.0.1:1->127.0.0.1:2\np654\nu0\n')).toEqual([
      { names: ['127.0.0.1:1->127.0.0.1:2'], pid: 321, uid: 501 },
      { names: [], pid: 654, uid: 0 },
    ]);
  });
});

describe('macOS lookup', () => {
  it('picks the process whose socket is exactly the caller end of this connection', async () => {
    const calls: string[][] = [];
    const run = async (file: string, args: string[]) => {
      calls.push([file, ...args]);
      if (file === 'lsof') {
        return [
          `p${process.pid}`,
          'u501',
          'n127.0.0.1:5000->127.0.0.1:61000',
          // Another process with a socket on the same port number, but a different connection.
          'p999',
          'u501',
          'n127.0.0.1:61000->127.0.0.1:7777',
          'p4321',
          'u501',
          'n127.0.0.1:61000->127.0.0.1:5000',
        ].join('\n');
      }
      if (file === 'ps') return '/Applications/Native App.app/Contents/MacOS/Native App\n';
      return '';
    };

    await expect(
      findPeerProcess(5000, 61000, { getuid: () => 501, platform: 'darwin', run }),
    ).resolves.toEqual({
      exePath: '/Applications/Native App.app/Contents/MacOS/Native App',
      pid: 4321,
      sameUser: true,
    });
    expect(calls[0]).toEqual([
      'lsof',
      '-nP',
      '-iTCP@127.0.0.1:61000',
      '-sTCP:ESTABLISHED',
      '-Fpun',
    ]);
  });

  it('reports another user, and finds nothing when lsof cannot see the socket', async () => {
    const other = async (file: string) =>
      file === 'lsof' ? 'p4321\nu502\nn127.0.0.1:61000->127.0.0.1:5000\n' : '/x\n';
    await expect(
      findPeerProcess(5000, 61000, { getuid: () => 501, platform: 'darwin', run: other }),
    ).resolves.toMatchObject({ sameUser: false });

    await expect(
      findPeerProcess(5000, 61000, { getuid: () => 501, platform: 'darwin', run: async () => '' }),
    ).resolves.toBeUndefined();
  });

  it('reports the owner of a listening port', async () => {
    const run = async () => 'p4321\nu502\n';
    await expect(
      findListener(53682, { getuid: () => 501, platform: 'darwin', run }),
    ).resolves.toEqual({
      pid: 4321,
      sameUser: false,
    });
  });
});

describe('Windows lookup', () => {
  it('parses the PowerShell result', async () => {
    const run = async () =>
      '{"pid":77,"exePath":"C:\\\\Program Files\\\\Native\\\\native.exe","sameUser":true}';

    await expect(findPeerProcess(5000, 61000, { platform: 'win32', run })).resolves.toEqual({
      exePath: 'C:\\Program Files\\Native\\native.exe',
      pid: 77,
      sameUser: true,
    });
    await expect(
      findListener(53682, { platform: 'win32', run: async () => '{"pid":77,"sameUser":false}' }),
    ).resolves.toEqual({
      pid: 77,
      sameUser: false,
    });
  });

  it('treats an unresolvable connection as unknown', async () => {
    await expect(
      findPeerProcess(5000, 61000, { platform: 'win32', run: async () => '' }),
    ).resolves.toBeUndefined();
  });
});

describe('Linux lookup from a /proc snapshot', () => {
  it("keeps another user's socket as another user even though its process is unreadable", async () => {
    const procRoot = await mkdtemp(path.join(os.tmpdir(), 'proc-'));
    await mkdir(path.join(procRoot, 'net'));
    await writeFile(
      path.join(procRoot, 'net/tcp'),
      [
        PROC_HEADER,
        procLine(61000, 5000, '01', 1001, 777),
        procLine(53682, 0, '0A', 1001, 778),
      ].join('\n'),
    );

    await expect(
      findPeerProcess(5000, 61000, { getuid: () => 1000, platform: 'linux', procRoot }),
    ).resolves.toEqual({
      exePath: undefined,
      pid: undefined,
      sameUser: false,
    });
    await expect(
      findListener(53682, { getuid: () => 1000, platform: 'linux', procRoot }),
    ).resolves.toEqual({
      pid: undefined,
      sameUser: false,
    });
  });
});

describe.runIf(process.platform === 'linux')('Linux lookup against real sockets', () => {
  let server: Server | undefined;
  let client: Socket | undefined;

  afterEach(async () => {
    client?.destroy();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  it('resolves the connecting process, its user and executable from the source port', async () => {
    server = createServer();
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const serverPort = (server.address() as AddressInfo).port;
    const accepted = new Promise<Socket>((resolve) => server!.once('connection', resolve));
    client = connect(serverPort, '127.0.0.1');
    await new Promise<void>((resolve) => client!.once('connect', resolve));
    const remotePort = (await accepted).remotePort!;

    const peer = await findPeerProcess(serverPort, remotePort);

    expect(peer?.pid).toBe(process.pid);
    expect(peer?.sameUser).toBe(true);
    expect(peer?.exePath).toBe(process.execPath);
    await expect(findListener(serverPort)).resolves.toEqual({ pid: process.pid, sameUser: true });
  });

  it('finds nothing for a connection that does not exist', async () => {
    await expect(findPeerProcess(1, 2)).resolves.toBeUndefined();
  });
});
