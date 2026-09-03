# Evidence manifest

Snapshot: 2026-09-03, repository commit `2794037573e1cc0dc5d02eb223463c61c5ca16d3`.

## Deterministic fixture hashes

```text
d6693da6b05a4a65eba1edff2bb9d29f8246a8c29d829a4613d6e2ea41cbe822  fixtures/excel-seed.csv
babcc656b7ca68a090b2c99060bc020c41c40c7d26031176b5332a1a4d98be1b  fixtures/expected-results.json
b7bbf3589440ff50e061f0922496b4e203829819b313024c4a28e1933e3416fe  fixtures/office-marker.svg
03057acffd329354c092279c8ec0f22ef0d3ed012193dfce96bda4969657d959  fixtures/ppt-storyboard.md
e365efe11595ac49657ff978ac140fe3d3bec63bddccfb2bb3c58cf2df84c839  fixtures/word-content.md
```

Existing repository smoke fixtures:

```text
7338a6c2978a9fdaf6575af3dd6e8681d5fc589f91e19e731bc2012e143b8111  packages/file-loaders/src/loaders/pptx/fixtures/test.pptx
019597d1701adb261b922d8a66e0f6f0db7d0bfd10659b8e822a8b6f4277db06  packages/file-loaders/src/loaders/excel/fixtures/test.xlsx
25ee9d2f05861810b44f6d866869f329b079a9a4d08b9ba7ec25cbeb06f62433  packages/file-loaders/src/loaders/docx/fixtures/test.docx
```

## Expected spreadsheet oracle calculation

Command:

```bash
node -e "const fs=require('fs');const rows=fs.readFileSync('docs/development/t-325-office-baseline/fixtures/excel-seed.csv','utf8').trim().split(/\n/).slice(1).map(r=>r.split(','));const vals=rows.map(r=>({region:r[1],amount:Number(r[3])*Number(r[4])}));const total=vals.reduce((s,r)=>s+r.amount,0);const region=Object.fromEntries([...new Set(vals.map(x=>x.region))].map(k=>[k,vals.filter(x=>x.region===k).reduce((s,x)=>s+x.amount,0)]));console.log(JSON.stringify({rows:rows.length,total,taxed:Number((total*1.13).toFixed(2)),region},null,2))"
```

Raw output:

```json
{
  "region": {
    "华东": 1765,
    "华南": 1350
  },
  "rows": 6,
  "taxed": 3519.95,
  "total": 3115
}
```

## Limits of this evidence set

- Loader tests prove extraction behavior only; they do not prove editing or export fidelity.
- Repository smoke fixtures are intentionally small and do not replace the rich scenarios in `test-scenarios.md`.
- ChatGPT/Codex UI was not accessible to browser automation in this run; official documentation is recorded as a declared comparison baseline, and interactive results remain `NV`.
- No Office artifact was authored in this run because the document skills require a workspace dependency loader that was not exposed. The reproducible neutral source fixtures and exact expected values are supplied so each comparison product can create the same OOXML test case during acceptance.

## Office UI source probe（原始输出）

Command:

```bash
for token in contentEditable onChange undo redo saving saved exportPptx exportXlsx exportDocx writeFile; do
  count=$(rg -i -c "$token" src/features/Portal/LocalFile/DocumentPreview.tsx || true)
  echo "$token=${count:-0}"
done
rg -n "PptxViewer.open|renderAsync\(|workbook.xlsx.load|MAX_PREVIEW_ROWS|cell.formula|anchor.download|openLocalFile|<td" src/features/Portal/LocalFile/DocumentPreview.tsx
```

Raw output:

```text
contentEditable=0
onChange=0
undo=0
redo=0
saving=0
saved=0
exportPptx=0
exportXlsx=0
exportDocx=0
writeFile=0
210:        viewer = await PptxViewer.open(blob, container, {
256:        await renderAsync(blob, container);
285:const MAX_PREVIEW_ROWS = 500;
307:    if (cell.formula !== undefined) return formatCellValue(cell.result);
327:        await workbook.xlsx.load(await blob.arrayBuffer());
335:            if (rows.length >= MAX_PREVIEW_ROWS) return;
342:          return { name: sheet.name, rows, truncated: sheet.actualRowCount > MAX_PREVIEW_ROWS };
383:                  <td key={cellIndex}>{cell}</td>
391:            {t('workingPanel.localFile.document.truncatedRows', { count: MAX_PREVIEW_ROWS })}
446:      anchor.download = filename;
470:          <Button onClick={() => localFileService.openLocalFile({ path: filePath })}>
```

Loader implementation probe:

```text
packages/file-loaders/src/loaders/excel/index.ts:74: const jsonData = xlsx.utils.sheet_to_json<Record<string, any>>(worksheet, {
packages/file-loaders/src/loaders/pptx/index.ts:79: const textNodes = pNode.getElementsByTagName('a:t');
packages/file-loaders/src/loaders/docx/index.ts:23: const result = await mammoth.extractRawText({ buffer });
```

## Loader 测试的实际断言摘录

```ts
// PPTX
expect(pages.length).toBeGreaterThan(1);
expect(pages).toMatchSnapshot();
expect(pages[0].metadata.error).toContain('All slides failed to parse correctly');

// Excel
expect(pages.length).toBeGreaterThan(0);
expect(pages).toMatchSnapshot();
expect(pages[0].pageContent).toBeTruthy();

// DOCX
expect(pages).toHaveLength(1);
expect(content).toEqual(pages[0].pageContent);
expect(content).toMatchSnapshot('aggregated_content');
```

对应实际执行结果：PPTX 6/6、Excel 4/4、DOCX 3/3，共 13/13 通过。它只证明导入 / 抽取，不证明编辑、保存或导出。
