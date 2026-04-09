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

export function truncate(str: string, maxWidth: number): string {
  let width = 0;
  let i = 0;
  for (const char of str) {
    const code = char.codePointAt(0)!;
    const cw =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0x303e) ||
      (code >= 0x3040 && code <= 0x33bf) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xa000 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff01 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x2fa1f)
        ? 2
        : 1;
    if (width + cw > maxWidth - 1) {
      return str.slice(0, i) + '…';
    }
    width += cw;
    i += char.length;
  }
  return str;
}

export function printTable(rows: string[][], header: string[]) {
  const allRows = [header, ...rows];
  const colWidths = header.map((_, i) => Math.max(...allRows.map((r) => displayWidth(r[i] || ''))));

  const headerLine = header.map((h, i) => padDisplay(h, colWidths[i])).join('  ');
  console.log(pc.bold(headerLine));

  for (const row of rows) {
    const line = row.map((cell, i) => padDisplay(cell || '', colWidths[i])).join('  ');
    console.log(line);
  }
}

// ── Box-drawing table ─────────────────────────────────────

interface BoxTableColumn {
  align?: 'left' | 'right';
  header: string | string[];
  key: string;
}

export interface BoxTableRow {
  [key: string]: string | string[];
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export function formatCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

// Strip ANSI escape codes for accurate width calculation
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replaceAll(/\x1B\[[0-9;]*m/g, '');
}

/**
 * Calculate the display width of a string in the terminal.
 * CJK characters and fullwidth symbols occupy 2 columns.
 */
export function displayWidth(s: string): number {
  const plain = stripAnsi(s);
  let width = 0;
  for (const char of plain) {
    const code = char.codePointAt(0)!;
    if (
      (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
      (code >= 0x2e80 && code <= 0x303e) || // CJK Radicals, Kangxi, Symbols
      (code >= 0x3040 && code <= 0x33bf) || // Hiragana, Katakana, Bopomofo, CJK Compat
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
      (code >= 0xa000 && code <= 0xa4cf) || // Yi Syllables/Radicals
      (code >= 0xac00 && code <= 0xd7af) || // Hangul Syllables
      (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
      (code >= 0xfe30 && code <= 0xfe6f) || // CJK Compatibility Forms
      (code >= 0xff01 && code <= 0xff60) || // Fullwidth Forms
      (code >= 0xffe0 && code <= 0xffe6) || // Fullwidth Signs
      (code >= 0x20000 && code <= 0x2fa1f) // CJK Extension B–F, Compatibility Supplement
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * Pad a string to the target display width, accounting for CJK double-width characters.
 */
function padDisplay(s: string, targetWidth: number, align: 'left' | 'right' = 'left'): string {
  const gap = targetWidth - displayWidth(s);
  if (gap <= 0) return s;
  return align === 'right' ? ' '.repeat(gap) + s : s + ' '.repeat(gap);
}

/**
 * Render a bordered table with box-drawing characters, similar to ccusage output.
 * Supports multi-line cells (string[]).
 */
export function printBoxTable(columns: BoxTableColumn[], rows: BoxTableRow[], title?: string) {
  // Calculate the display height of each row (max lines across all cells)
  const rowHeights = rows.map((row) => {
    let maxLines = 1;
    for (const col of columns) {
      const val = row[col.key];
      if (Array.isArray(val) && val.length > maxLines) maxLines = val.length;
    }
    return maxLines;
  });

  // Calculate column widths: max of header width and all cell widths
  const colWidths = columns.map((col) => {
    const headerLines = Array.isArray(col.header) ? col.header : [col.header];
    let maxW = Math.max(...headerLines.map((h) => displayWidth(h)));
    for (const row of rows) {
      const val = row[col.key];
      const lines = Array.isArray(val) ? val : [val || ''];
      for (const line of lines) {
        const w = displayWidth(line);
        if (w > maxW) maxW = w;
      }
    }
    return maxW;
  });

  // Box-drawing chars
  const TL = '┌',
    TR = '┐',
    BL = '└',
    BR = '┘';
  const H = '─',
    V = '│';
  const TJ = '┬',
    BJ = '┴',
    LJ = '├',
    RJ = '┤',
    CJ = '┼';

  const pad = (s: string, w: number, align: 'left' | 'right' = 'left') => {
    return padDisplay(s, w, align);
  };

  const hLine = (left: string, mid: string, right: string) =>
    left + colWidths.map((w) => H.repeat(w + 2)).join(mid) + right;

  const renderRow = (cells: string[], align?: ('left' | 'right')[]) =>
    V +
    cells.map((c, i) => ' ' + pad(c, colWidths[i], align?.[i] || columns[i].align) + ' ').join(V) +
    V;

  // Title box
  if (title) {
    const totalWidth = colWidths.reduce((a, b) => a + b, 0) + (colWidths.length - 1) * 3 + 4;
    const innerW = totalWidth - 4;
    const titlePad = Math.max(0, innerW - displayWidth(title));
    const leftPad = Math.floor(titlePad / 2);
    const rightPad = titlePad - leftPad;
    console.log();
    console.log(' ╭' + '─'.repeat(innerW + 2) + '╮');
    console.log(' │ ' + ' '.repeat(leftPad) + pc.bold(title) + ' '.repeat(rightPad) + ' │');
    console.log(' ╰' + '─'.repeat(innerW + 2) + '╯');
    console.log();
  }

  // Header
  const headerHeight = Math.max(
    ...columns.map((c) => (Array.isArray(c.header) ? c.header.length : 1)),
  );

  console.log(hLine(TL, TJ, TR));
  for (let line = 0; line < headerHeight; line++) {
    const cells = columns.map((col) => {
      const headerLines = Array.isArray(col.header) ? col.header : [col.header];
      return headerLines[line] || '';
    });
    console.log(
      renderRow(
        cells,
        columns.map(() => 'left'),
      ),
    );
  }
  console.log(hLine(LJ, CJ, RJ));

  // Data rows
  rows.forEach((row, rowIdx) => {
    const height = rowHeights[rowIdx];
    for (let line = 0; line < height; line++) {
      const cells = columns.map((col) => {
        const val = row[col.key];
        const lines = Array.isArray(val) ? val : [val || ''];
        return lines[line] || '';
      });
      console.log(renderRow(cells));
    }
    if (rowIdx < rows.length - 1) {
      console.log(hLine(LJ, CJ, RJ));
    }
  });

  console.log(hLine(BL, BJ, BR));
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

// ── Calendar Heatmap ──────────────────────────────────────

interface CalendarDay {
  day: string; // YYYY-MM-DD
  value: number;
}

const HEATMAP_BLOCKS = [' ', '░', '▒', '▓', '█'];
const WEEKDAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

/**
 * Render a GitHub-style calendar heatmap for usage data.
 * Each column is a week, rows are weekdays (Mon-Sun).
 */
export function printCalendarHeatmap(
  data: CalendarDay[],
  options?: { label?: string; title?: string },
) {
  if (data.length === 0) return;

  // Build a value map
  const valueMap = new Map<string, number>();
  let maxVal = 0;
  for (const d of data) {
    valueMap.set(d.day, d.value);
    if (d.value > maxVal) maxVal = d.value;
  }

  // Determine date range - pad to full weeks
  const sorted = [...data].sort((a, b) => a.day.localeCompare(b.day));
  const firstDate = new Date(sorted[0].day);
  const lastDate = new Date(sorted.at(-1).day);

  // Adjust to start on Monday
  const startDay = firstDate.getDay(); // 0=Sun, 1=Mon, ...
  const mondayOffset = startDay === 0 ? 6 : startDay - 1;
  const start = new Date(firstDate);
  start.setDate(start.getDate() - mondayOffset);

  // Adjust to end on Sunday
  const endDay = lastDate.getDay();
  const sundayOffset = endDay === 0 ? 0 : 7 - endDay;
  const end = new Date(lastDate);
  end.setDate(end.getDate() + sundayOffset);

  // Build grid: 7 rows (Mon-Sun) x N weeks
  const weeks: string[][] = [];
  const current = new Date(start);
  let weekCol: string[] = [];

  while (current <= end) {
    const key = current.toISOString().slice(0, 10);
    const val = valueMap.get(key) || 0;

    // Quantize to block level
    let level: number;
    if (val === 0) {
      level = 0;
    } else if (maxVal > 0) {
      level = Math.ceil((val / maxVal) * 4);
      if (level < 1) level = 1;
      if (level > 4) level = 4;
    } else {
      level = 0;
    }

    // Color the block
    const block = HEATMAP_BLOCKS[level];
    const colored = level > 0 ? pc.green(block) : pc.dim(block);

    weekCol.push(colored);

    if (weekCol.length === 7) {
      weeks.push(weekCol);
      weekCol = [];
    }

    current.setDate(current.getDate() + 1);
  }
  if (weekCol.length > 0) {
    while (weekCol.length < 7) weekCol.push(' ');
    weeks.push(weekCol);
  }

  // Print title
  if (options?.title) {
    console.log();
    console.log(pc.bold(options.title));
  }

  // Print month labels on top, aligned with week columns
  const monthLine: string[] = [];
  let lastMonth = '';
  for (let w = 0; w < weeks.length; w++) {
    const weekStart = new Date(start);
    weekStart.setDate(weekStart.getDate() + w * 7);
    const monthStr = weekStart.toLocaleString('en-US', { month: 'short' });
    if (monthStr !== lastMonth) {
      monthLine.push(monthStr.padEnd(2));
      lastMonth = monthStr;
    } else {
      monthLine.push('  ');
    }
  }
  console.log(pc.dim('     ' + monthLine.join('')));

  // Print each row (weekday)
  for (let row = 0; row < 7; row++) {
    const label = (WEEKDAY_LABELS[row] || '').padEnd(4);
    const cells = weeks.map((week) => week[row] || ' ').join(' ');
    console.log(pc.dim(label) + ' ' + cells);
  }

  // Legend
  const legend =
    '     ' +
    pc.dim('Less ') +
    HEATMAP_BLOCKS.map((b, i) => (i === 0 ? pc.dim(b) : pc.green(b))).join(' ') +
    pc.dim(' More');
  console.log();
  console.log(legend);

  // Label
  if (options?.label) {
    console.log(pc.dim(`     ${options.label}`));
  }
  console.log();
}

// ── Kanban Board ─────────────────────────────────────

export interface KanbanColumn {
  color?: (s: string) => string;
  items: KanbanCard[];
  title: string;
}

export interface KanbanCard {
  badge?: string;
  meta?: string;
  title: string;
}

/**
 * Render a kanban board with side-by-side columns.
 * Adapts column width to terminal width automatically.
 */
export function printKanban(columns: KanbanColumn[]) {
  // Filter out empty columns
  const cols = columns.filter((c) => c.items.length > 0);
  if (cols.length === 0) return;

  const termWidth = process.stdout.columns || 100;
  // Each column gets equal width, with 1-char gap between
  const colWidth = Math.max(20, Math.floor((termWidth - (cols.length - 1)) / cols.length));
  const innerWidth = colWidth - 4; // 2 chars border + 2 padding

  const maxRows = Math.max(...cols.map((c) => c.items.length));

  // ── Header ──
  const topBorder = cols
    .map((c) => {
      const titleStr = ` ${c.title} (${c.items.length}) `;
      const color = c.color || pc.white;
      const remaining = colWidth - 2 - displayWidth(titleStr);
      const left = Math.floor(remaining / 2);
      const right = remaining - left;
      return color(
        '┌' + '─'.repeat(Math.max(0, left)) + titleStr + '─'.repeat(Math.max(0, right)) + '┐',
      );
    })
    .join(' ');
  console.log(topBorder);

  // ── Rows ──
  for (let row = 0; row < maxRows; row++) {
    const line = cols
      .map((c) => {
        const color = c.color || pc.white;
        const item = c.items[row];
        if (!item) {
          return color('│') + ' '.repeat(colWidth - 2) + color('│');
        }

        const badge = item.badge ? item.badge + ' ' : '';
        const badgeWidth = displayWidth(badge);
        const titleMaxWidth = innerWidth - badgeWidth;
        const title = truncate(item.title, titleMaxWidth);
        const titleWidth = displayWidth(title);
        const pad = ' '.repeat(Math.max(0, colWidth - 2 - badgeWidth - titleWidth - 2));
        return color('│') + ' ' + badge + title + pad + ' ' + color('│');
      })
      .join(' ');
    console.log(line);

    // Print meta line if any card in this row has meta
    const hasMeta = cols.some((c) => c.items[row]?.meta);
    if (hasMeta) {
      const metaLine = cols
        .map((c) => {
          const color = c.color || pc.white;
          const item = c.items[row];
          if (!item?.meta) {
            return color('│') + ' '.repeat(colWidth - 2) + color('│');
          }
          const meta = truncate(item.meta, innerWidth);
          const metaWidth = displayWidth(meta);
          const pad = ' '.repeat(Math.max(0, colWidth - 2 - metaWidth - 2));
          return color('│') + ' ' + pc.dim(meta) + pad + ' ' + color('│');
        })
        .join(' ');
      console.log(metaLine);
    }
  }

  // ── Bottom border ──
  const bottomBorder = cols
    .map((c) => {
      const color = c.color || pc.white;
      return color('└' + '─'.repeat(colWidth - 2) + '┘');
    })
    .join(' ');
  console.log(bottomBorder);
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
