import { describe, expect, it } from 'vitest';

import {
  classifyAddress,
  parseLsofCwd,
  parseLsofListen,
  parseNetstat,
  parseProcNetTcp,
  parseTasklist,
  summarizeListeners,
} from '../listeningPorts';

describe('classifyAddress', () => {
  it.each([
    ['*', 'any'],
    ['0.0.0.0', 'any'],
    ['[::]', 'any'],
    ['127.0.0.1', 'ipv4-loopback'],
    ['[::1]', 'ipv6-loopback'],
    ['192.168.1.20', 'unreachable'],
  ])('%s → %s', (address, kind) => {
    expect(classifyAddress(address)).toBe(kind);
  });
});

describe('macOS lsof', () => {
  // Real `lsof -nP -iTCP -sTCP:LISTEN -F pcn` shape.
  const listen = [
    'p19146',
    'cnode',
    'f32',
    'n[::1]:5173',
    'p607',
    'cPython',
    'f4',
    'n*:18000',
    'f5',
    'n127.0.0.1:18000',
    'p900',
    'cpostgres',
    'f6',
    'n192.168.1.20:5432',
  ].join('\n');

  it('parses pid, command and every listening address', () => {
    expect(parseLsofListen(listen)).toEqual([
      { address: '[::1]', command: 'node', pid: 19146, port: 5173 },
      { address: '*', command: 'Python', pid: 607, port: 18000 },
      { address: '127.0.0.1', command: 'Python', pid: 607, port: 18000 },
      { address: '192.168.1.20', command: 'postgres', pid: 900, port: 5432 },
    ]);
  });

  it('parses the cwd lookup', () => {
    const cwds = parseLsofCwd(
      ['p19146', 'fcwd', 'n/private/tmp/app', 'p607', 'fcwd', 'n/'].join('\n'),
    );
    expect([...cwds]).toEqual([
      [19146, '/private/tmp/app'],
      [607, '/'],
    ]);
  });
});

describe('Linux /proc/net/tcp', () => {
  const header =
    '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode';

  it('decodes listening IPv4 sockets and skips other states', () => {
    const content = [
      header,
      '   0: 0100007F:1435 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 11111 1',
      '   1: 00000000:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 22222 1',
      '   2: 0100007F:1435 0100007F:C350 01 00000000:00000000 00:00000000 00000000  1000        0 33333 1',
    ].join('\n');

    expect(parseProcNetTcp(content, 'v4')).toEqual([
      { address: '127.0.0.1', inode: '11111', port: 5173 },
      { address: '0.0.0.0', inode: '22222', port: 22 },
    ]);
  });

  it('decodes IPv6 loopback and wildcard', () => {
    const content = [
      header,
      '   0: 00000000000000000000000001000000:1435 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 44444 1',
      '   1: 00000000000000000000000000000000:0BB8 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 55555 1',
    ].join('\n');

    expect(parseProcNetTcp(content, 'v6')).toEqual([
      { address: '::1', inode: '44444', port: 5173 },
      { address: '::', inode: '55555', port: 3000 },
    ]);
  });
});

describe('Windows netstat', () => {
  it('parses LISTENING rows for both families', () => {
    const output = [
      'Active Connections',
      '  Proto  Local Address          Foreign Address        State           PID',
      '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1044',
      '  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       8812',
      '  TCP    [::1]:3000             [::]:0                 LISTENING       9001',
      '  TCP    10.0.0.4:52100         20.1.1.1:443           ESTABLISHED     7000',
    ].join('\r\n');

    expect(parseNetstat(output)).toEqual([
      { address: '0.0.0.0', pid: 1044, port: 135 },
      { address: '127.0.0.1', pid: 8812, port: 5173 },
      { address: '[::1]', pid: 9001, port: 3000 },
    ]);
  });

  it('parses tasklist image names', () => {
    const names = parseTasklist(
      '"node.exe","8812","Console","1","52,120 K"\r\n"svchost.exe","1044","Services","0","9,000 K"',
    );
    expect(names.get(8812)).toBe('node.exe');
    expect(names.get(1044)).toBe('svchost.exe');
  });
});

describe('summarizeListeners', () => {
  const entries = [
    { address: '[::1]', command: 'node', pid: 1, port: 5173 },
    { address: '*', command: 'postgres', pid: 2, port: 5432 },
    { address: '127.0.0.1', command: 'next-server', pid: 3, port: 3000 },
    { address: '[::1]', command: 'next-server', pid: 3, port: 3000 },
    { address: '192.168.1.20', command: 'lan-only', pid: 4, port: 8080 },
    { address: '127.0.0.1', command: 'lobehub', pid: 99, port: 7777 },
  ];
  const cwds = new Map([
    [1, '/work/app/packages/web'],
    [2, '/'],
    [3, '/work/app'],
    [4, '/work/app'],
  ]);

  it('puts the project first, folds families, and drops what a tunnel cannot reach', () => {
    const ports = summarizeListeners(entries, { cwd: '/work/app', cwds, ownPid: 99 });

    expect(ports).toEqual([
      {
        command: 'next-server',
        cwd: '/work/app',
        inProject: true,
        loopback: 'both',
        pid: 3,
        port: 3000,
      },
      {
        command: 'node',
        cwd: '/work/app/packages/web',
        inProject: true,
        loopback: 'ipv6',
        pid: 1,
        port: 5173,
      },
      { command: 'postgres', cwd: '/', inProject: false, loopback: 'both', pid: 2, port: 5432 },
    ]);
  });

  it('does not treat a sibling directory with a shared prefix as inside the project', () => {
    const ports = summarizeListeners([{ address: '*', command: 'node', pid: 5, port: 4000 }], {
      cwd: '/work/app',
      cwds: new Map([[5, '/work/app-old']]),
    });
    expect(ports[0].inProject).toBe(false);
  });
});
