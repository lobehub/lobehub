import { createInterface } from 'node:readline';

import pc from 'picocolors';

export function timeAgo(date: Date | string): string {
  const diff = Date.now() - new Date(date).getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
}

export function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len - 1) + '…';
}

export function printTable(rows: string[][], header: string[]) {
  const allRows = [header, ...rows];
  const colWidths = header.map((_, i) => Math.max(...allRows.map((r) => (r[i] || '').length)));

  const headerLine = header.map((h, i) => h.padEnd(colWidths[i])).join('  ');
  console.log(pc.bold(headerLine));

  for (const row of rows) {
    const line = row.map((cell, i) => (cell || '').padEnd(colWidths[i])).join('  ');
    console.log(line);
  }
}

export function pickFields(obj: Record<string, any>, fields: string[]): Record<string, any> {
  const result: Record<string, any> = {};
  for (const f of fields) {
    if (f in obj) result[f] = obj[f];
  }
  return result;
}

export function outputJson(data: unknown, fields?: string) {
  if (fields) {
    const fieldList = fields.split(',').map((f) => f.trim());
    if (Array.isArray(data)) {
      console.log(
        JSON.stringify(
          data.map((item) => pickFields(item, fieldList)),
          null,
          2,
        ),
      );
    } else if (data && typeof data === 'object') {
      console.log(JSON.stringify(pickFields(data as Record<string, any>, fieldList), null, 2));
    }
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

export function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(`${message} (y/N) `, (answer: string) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}
