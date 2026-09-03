import { mkdir, readFile, writeFile } from 'node:fs/promises';

import ExcelJS from 'exceljs';

import {
  editXlsx,
  exportXlsx,
  loadXlsx,
} from '../src/features/FileViewer/Renderer/XLSX/xlsxOperations';

const outputDirectory = 'outputs/t-327';

const table = (sheet: ExcelJS.Worksheet, range: string) => {
  const [start, end] = range.split(':');
  const startCell = sheet.getCell(start);
  const endCell = sheet.getCell(end);
  return Array.from({ length: endCell.row - startCell.row + 1 }, (_, rowOffset) =>
    Array.from({ length: endCell.col - startCell.col + 1 }, (_, columnOffset) => {
      const cell = sheet.getCell(startCell.row + rowOffset, startCell.col + columnOffset);
      return {
        address: cell.address,
        formula: cell.formula || null,
        text: cell.text,
        value: cell.result ?? cell.value,
      };
    }),
  );
};

const snapshot = async (bytes: ArrayBuffer, range = 'A1:F6') => {
  const workbook = await loadXlsx(bytes);
  const sales = workbook.getWorksheet('Sales');
  return {
    sales: sales ? table(sales, range) : null,
    sheets: workbook.worksheets.map((sheet) => sheet.name),
  };
};

await mkdir(outputDirectory, { recursive: true });
const workbook = new ExcelJS.Workbook();
const sales = workbook.addWorksheet('Sales');
sales.addRows([
  ['Item', 'Qty', 'Price', 'Total', 'Taxed total', 'Margin'],
  [
    'Alpha',
    2,
    10,
    { formula: 'B2*C2', result: 20 },
    { formula: "'Assumptions'!A2*D2", result: 2 },
    0.25,
  ],
  [
    'Beta',
    3,
    5,
    { formula: 'B3*C3', result: 15 },
    { formula: "'Assumptions'!A2*D3", result: 1.5 },
    0.2,
  ],
  [
    'Grand total',
    null,
    null,
    { formula: 'SUM(D2:D3)', result: 35 },
    { formula: 'SUM(E2:E3)', result: 3.5 },
  ],
]);
sales.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
sales.getRow(1).fill = { fgColor: { argb: 'FF1F4E78' }, pattern: 'solid', type: 'pattern' };
sales.getColumn(3).numFmt = '$#,##0.00';
sales.getColumn(4).numFmt = '$#,##0.00';
sales.getColumn(5).numFmt = '$#,##0.00';
sales.getColumn(6).numFmt = '0.0%';
sales.columns.forEach((column) => {
  column.width = 16;
});
const assumptions = workbook.addWorksheet('Assumptions');
assumptions.addRows([['Tax rate'], [0.1]]);
assumptions.getCell('A2').numFmt = '0.0%';

let bytes = await exportXlsx(workbook);
const evidence: Record<string, unknown> = { initial: await snapshot(bytes) };

bytes = await editXlsx(bytes, {
  range: 'B2:C2',
  sheet: 'Sales',
  type: 'setCells',
  values: [[4, 12.5]],
});
evidence.afterModifyRegion = await snapshot(bytes, 'A1:F4');
evidence.beforeNewCellWrite = await snapshot(bytes, 'G1:G2');
bytes = await editXlsx(bytes, {
  range: 'G2',
  sheet: 'Sales',
  type: 'setCells',
  values: [['New entry']],
});
evidence.afterNewCellWrite = await snapshot(bytes, 'G1:G2');
evidence.beforeSingleCellCopy = await snapshot(bytes, 'B2:H2');
bytes = await editXlsx(bytes, { from: 'B2', sheet: 'Sales', to: 'H2', type: 'copyRange' });
evidence.afterSingleCellCopy = await snapshot(bytes, 'B2:H2');
bytes = await editXlsx(bytes, { from: 'A2:F3', sheet: 'Sales', to: 'A5:F6', type: 'copyRange' });
evidence.afterCopyRegion = await snapshot(bytes, 'A1:F6');
evidence.beforeCrossRegionCopy = await snapshot(bytes, 'H4:I6');
bytes = await editXlsx(bytes, {
  from: 'B2:C3',
  sheet: 'Sales',
  to: 'H5:I6',
  type: 'copyRange',
});
evidence.afterCrossRegionCopy = await snapshot(bytes, 'H4:I6');
bytes = await editXlsx(bytes, { range: 'A6:F6', sheet: 'Sales', type: 'clearRange' });
evidence.afterDeleteRegion = await snapshot(bytes, 'A5:F6');
evidence.beforeNonContiguousWrite = await snapshot(bytes, 'A8:F8');
bytes = await editXlsx(bytes, {
  areas: [
    { range: 'A8', values: [['North']] },
    { range: 'C8:D8', values: [[120, 240]] },
    { range: 'F8', values: [[0.3]] },
  ],
  sheet: 'Sales',
  type: 'setAreas',
});
evidence.afterNonContiguousWrite = await snapshot(bytes, 'A8:F8');
bytes = await editXlsx(bytes, {
  ranges: ['A8', 'C8:D8', 'F8'],
  sheet: 'Sales',
  type: 'clearAreas',
});
evidence.afterNonContiguousDelete = await snapshot(bytes, 'A8:F8');

bytes = await editXlsx(bytes, { at: 3, sheet: 'Sales', type: 'insertRows' });
evidence.afterInsertRow = await snapshot(bytes, 'A1:F7');
bytes = await editXlsx(bytes, { at: 3, sheet: 'Sales', type: 'deleteRows' });
evidence.afterDeleteRow = await snapshot(bytes, 'A1:F6');
bytes = await editXlsx(bytes, { at: 2, sheet: 'Sales', type: 'insertColumns' });
evidence.afterInsertColumn = await snapshot(bytes, 'A1:G6');
bytes = await editXlsx(bytes, { at: 2, sheet: 'Sales', type: 'deleteColumns' });
evidence.afterDeleteColumn = await snapshot(bytes, 'A1:F6');

evidence.beforeSheetOperations = await snapshot(bytes);
bytes = await editXlsx(bytes, { name: 'Notes', type: 'addSheet' });
evidence.afterAddSheet = await snapshot(bytes);
bytes = await editXlsx(bytes, { name: 'Notes', newName: 'Archive', type: 'renameSheet' });
evidence.afterRenameSheet = await snapshot(bytes);
bytes = await editXlsx(bytes, { fromIndex: 2, toIndex: 0, type: 'moveSheet' });
evidence.afterMoveSheet = await snapshot(bytes);
bytes = await editXlsx(bytes, {
  range: 'D2:F2',
  sheet: 'Sales',
  style: { bold: true, fill: '#FFF2CC', horizontal: 'right' },
  type: 'setStyle',
});

const reopened = await loadXlsx(bytes);
const reopenedSales = reopened.getWorksheet('Sales')!;
evidence.formulaChecks = [
  {
    actual: reopenedSales.getCell('D2').result,
    expected: 50,
    expression: 'B2*C2',
    inputs: { B2: 4, C2: 12.5 },
  },
  {
    actual: reopenedSales.getCell('E2').result,
    expected: 5,
    expression: "'Assumptions'!A2*D2",
    inputs: { "'Assumptions'!A2": 0.1, 'D2': 50 },
  },
  {
    actual: reopenedSales.getCell('D4').result,
    expected: 65,
    expression: 'SUM(D2:D3)',
    inputs: { D2: 50, D3: 15 },
  },
];
evidence.formatChecks = {
  currency: {
    address: 'D2',
    displayed: reopenedSales.getCell('D2').text,
    numberFormat: reopenedSales.getCell('D2').numFmt,
  },
  percent: {
    address: 'F2',
    displayed: reopenedSales.getCell('F2').text,
    numberFormat: reopenedSales.getCell('F2').numFmt,
  },
  style: {
    alignment: reopenedSales.getCell('D2').alignment,
    fill: reopenedSales.getCell('D2').fill,
    font: reopenedSales.getCell('D2').font,
  },
};
evidence.finalReopen = await snapshot(bytes);
evidence.beforeDiskSave = {
  formatChecks: evidence.formatChecks,
  formulaChecks: evidence.formulaChecks,
  snapshot: await snapshot(bytes),
};

await writeFile(`${outputDirectory}/excel-reliability.xlsx`, new Uint8Array(bytes));
const savedBytes = await readFile(`${outputDirectory}/excel-reliability.xlsx`);
const diskArrayBuffer = savedBytes.buffer.slice(
  savedBytes.byteOffset,
  savedBytes.byteOffset + savedBytes.byteLength,
) as ArrayBuffer;
const diskWorkbook = await loadXlsx(diskArrayBuffer);
const diskSales = diskWorkbook.getWorksheet('Sales')!;
evidence.afterDiskReopen = {
  formatChecks: {
    currency: {
      address: 'D2',
      numberFormat: diskSales.getCell('D2').numFmt,
    },
    percent: {
      address: 'F2',
      numberFormat: diskSales.getCell('F2').numFmt,
    },
    style: {
      alignment: diskSales.getCell('D2').alignment,
      fill: diskSales.getCell('D2').fill,
      font: diskSales.getCell('D2').font,
    },
  },
  formulaChecks: ['D2', 'E2', 'D4'].map((address) => ({
    address,
    formula: diskSales.getCell(address).formula,
    value: diskSales.getCell(address).result,
  })),
  snapshot: await snapshot(diskArrayBuffer),
};
await writeFile(
  `${outputDirectory}/operation-evidence.json`,
  `${JSON.stringify(evidence, null, 2)}\n`,
);
await writeFile(
  `${outputDirectory}/cell-operation-evidence.html`,
  `<!doctype html><meta charset="utf-8"><style>body{font:14px system-ui;margin:24px;color:#172033}h1{font-size:22px}h2{font-size:16px;margin-top:22px}.op{display:grid;grid-template-columns:160px 1fr 1fr;gap:8px;margin:8px 0}.head{font-weight:700;background:#163f68;color:#fff}.cell{padding:8px;border:1px solid #b7c4d3}.ok{background:#e7f6ed}.empty{color:#718096;background:#f6f8fa}code{font-weight:700}</style><h1>T-327 单元格与区域操作快照</h1><div class="op head"><div class="cell">操作</div><div class="cell">Before / Source</div><div class="cell">After / Target</div></div><h2>新值写入空单元格</h2><div class="op"><div class="cell"><code>SET G2</code></div><div class="cell empty">G2 = null</div><div class="cell ok">G2 = New entry</div></div><h2>单元格 → 单元格复制</h2><div class="op"><div class="cell"><code>COPY B2 → H2</code></div><div class="cell">B2 = 4</div><div class="cell ok">H2 = 4</div></div><h2>连续区域 → 区域复制</h2><div class="op"><div class="cell"><code>COPY A2:F2 → A5:F5</code></div><div class="cell">Alpha | 4 | 12.5 | 50 | 5 | 0.25</div><div class="cell ok">Alpha | 4 | 12.5 | 50 | 5 | 0.25</div></div><h2>跨单元格 2×2 区域复制</h2><div class="op"><div class="cell"><code>COPY B2:C3 → H5:I6</code></div><div class="cell">[[4,12.5],[3,5]]</div><div class="cell ok">[[4,12.5],[3,5]]</div></div><h2>非连续多区域写入 / 删除</h2><div class="op"><div class="cell"><code>SET A8,C8:D8,F8</code></div><div class="cell empty">[null,null,null,null,null,null]</div><div class="cell ok">[North,null,120,240,null,0.3]</div></div><div class="op"><div class="cell"><code>CLEAR A8,C8:D8,F8</code></div><div class="cell">[North,null,120,240,null,0.3]</div><div class="cell ok">[null,null,null,null,null,null]</div></div>`,
);
console.log(
  JSON.stringify(
    {
      formulaChecks: evidence.formulaChecks,
      formatChecks: evidence.formatChecks,
      sheets: reopened.worksheets.map((sheet) => sheet.name),
    },
    null,
    2,
  ),
);
