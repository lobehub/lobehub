import type { CellModel, RowModel, SheetModel } from './model';

export type BodyItem =
  | { cells: CellModel[]; extras: CellModel[]; kind: 'data' | 'total' }
  | { cells: CellModel[]; kind: 'kv' };

export interface SheetSection {
  blank: number;
  body: BodyItem[];
  header: CellModel[] | null;
  notes: string[];
  title: string | null;
}

export interface SheetOutline {
  bodyFontSize: number;
  confidence: number;
  mode: 'reflow' | 'fidelity';
  sections: SheetSection[];
  stats: { aside: number; chrome: number; kv: number; note: number; table: number };
  subtitle: CellModel | null;
  title: CellModel | null;
}

const TOTAL_WORDS = /合计|小计|总计|净额|总额|汇总|total|sum|subtotal/i;

const CONFIDENCE_FLOOR = 0.7;

const KV_WEIGHT = 0.6;

const fontSize = (cell: CellModel) => cell.s.fs ?? 11;

interface ContentRow {
  blankAfter: number;
  cells: CellModel[];
  r: number;
}

const readContent = (rows: RowModel[]): ContentRow[] => {
  const content: ContentRow[] = [];
  for (const row of rows) {
    const cells = row.cells.filter((cell) => cell.t.trim());
    if (cells.length > 0) content.push({ blankAfter: 0, cells, r: row.r });
    else if (content.length > 0) content.at(-1)!.blankAfter += 1;
  }
  return content;
};

export const classifySheet = (sheet: SheetModel): SheetOutline => {
  const colCount = sheet.cols.length;
  const content = readContent(sheet.rows);

  const isBand = (row: ContentRow) => {
    const [cell] = row.cells;
    return row.cells.length === 1 && cell.c === 1 && (cell.cs ?? 1) >= Math.max(2, colCount * 0.8);
  };

  const bodySizes = content
    .filter((row) => !isBand(row))
    .flatMap((row) => row.cells.map((cell) => fontSize(cell)))
    .sort((a, b) => a - b);
  const bodyFontSize = bodySizes.length > 0 ? bodySizes[Math.floor(bodySizes.length / 2)] : 11;

  const bands = content.filter((row) => isBand(row));
  const largestBand = bands.reduce((max, row) => Math.max(max, fontSize(row.cells[0])), 0);
  const topBands = bands.filter((row) => fontSize(row.cells[0]) === largestBand);

  let title: CellModel | null = null;
  let subtitle: CellModel | null = null;
  let start = 0;

  const [firstRow, secondRow] = content;
  if (
    firstRow &&
    isBand(firstRow) &&
    firstRow.r <= 2 &&
    fontSize(firstRow.cells[0]) === largestBand &&
    largestBand > bodyFontSize &&
    topBands.length === 1
  ) {
    title = firstRow.cells[0];
    start = 1;
    if (
      secondRow &&
      isBand(secondRow) &&
      secondRow.cells[0].s.bg === title.s.bg &&
      fontSize(secondRow.cells[0]) < largestBand
    ) {
      subtitle = secondRow.cells[0];
      start = 2;
    }
  }

  const isSectionBand = (row: ContentRow) => {
    if (!isBand(row)) return false;
    const [cell] = row.cells;
    return Boolean(cell.s.b) && (Boolean(cell.s.bg) || fontSize(cell) > bodyFontSize);
  };

  interface DraftSection extends SheetSection {
    rows: { cells: CellModel[]; kind: 'note' | 'row' }[];
  }

  const sections: DraftSection[] = [];
  let current: DraftSection | null = null;
  const openSection = (sectionTitle: string | null): DraftSection => {
    const section: DraftSection = {
      blank: 0,
      body: [],
      header: null,
      notes: [],
      rows: [],
      title: sectionTitle,
    };
    sections.push(section);
    return section;
  };

  for (const row of content.slice(start)) {
    if (isSectionBand(row)) {
      current = openSection(row.cells[0].t);
      continue;
    }
    current ??= openSection(null);
    if (isBand(row)) {
      current.rows.push({ cells: row.cells, kind: 'note' });
      continue;
    }
    current.rows.push({ cells: row.cells, kind: 'row' });
    current.blank += row.blankAfter;
  }

  const findHeader = (section: DraftSection) => {
    const rows = section.rows;
    for (const [index, item] of rows.entries()) {
      if (item.kind !== 'row' || item.cells.length < 2) continue;
      if (!item.cells.every((cell) => cell.s.b && cell.s.bg)) continue;
      const background = item.cells[0].s.bg;
      if (!item.cells.every((cell) => cell.s.bg === background)) continue;
      if (item.cells.some((cell) => TOTAL_WORDS.test(cell.t))) continue;
      if (!rows.slice(index + 1).some((next) => next.kind === 'row')) continue;
      return item;
    }
    return null;
  };

  const stats = { aside: 0, chrome: 0, kv: 0, note: 0, table: 0 };
  if (title) stats.chrome += 1;
  if (subtitle) stats.chrome += 1;

  for (const section of sections) {
    if (section.title) stats.chrome += 1;
    const header = findHeader(section);
    section.header = header?.cells ?? null;
    const headerColumns = header?.cells.map((cell) => cell.c) ?? [];

    for (const item of section.rows) {
      if (item.kind === 'note') {
        section.notes.push(item.cells[0].t);
        stats.note += 1;
        continue;
      }
      if (header && item === header) {
        stats.chrome += 1;
        continue;
      }
      if (!header) {
        section.body.push({ cells: item.cells, kind: 'kv' });
        stats.kv += 1;
        continue;
      }

      const inColumns = item.cells.filter((cell) => headerColumns.includes(cell.c));
      const extras = item.cells.filter((cell) => !headerColumns.includes(cell.c));
      const fits =
        inColumns.length >= Math.ceil(item.cells.length * 0.6) &&
        headerColumns.includes(item.cells[0].c);

      if (!fits) {
        stats.aside += 1;
        section.body.push({ cells: item.cells, kind: 'kv' });
        continue;
      }

      const isTotal = item.cells.some((cell) => TOTAL_WORDS.test(cell.t));
      section.body.push({ cells: inColumns, extras, kind: isTotal ? 'total' : 'data' });
      stats.table += 1;
    }
  }

  const scored = stats.table + stats.chrome + stats.note + stats.kv * KV_WEIGHT;
  const weighted = stats.table + stats.chrome + stats.note + stats.kv + stats.aside;
  const confidence = weighted > 0 ? scored / weighted : 0;

  return {
    bodyFontSize,
    confidence,
    mode: confidence >= CONFIDENCE_FLOOR ? 'reflow' : 'fidelity',
    sections: sections.map(({ rows, ...section }) => section),
    stats,
    subtitle,
    title,
  };
};
