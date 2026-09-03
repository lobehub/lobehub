import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { editDocx, inspectDocx } from './docxOperations';

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<w:body>
<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Office round-trip fixture</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>LH-OFFICE-V1-DOC-H1</w:t></w:r></w:p>
<w:p><w:r><w:t>中文保真检查 ✅</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Item</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Status</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Export</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Pending</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:hyperlink r:id="rId7"><w:r><w:t>LobeHub source</w:t></w:r></w:hyperlink></w:p>
<w:p><w:r><w:drawing><a:blip r:embed="rId8"/></w:drawing></w:r></w:p>
<w:sectPr/></w:body></w:document>`;

const makeFixture = async () => {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  );
  zip.file('word/document.xml', documentXml);
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://github.com/lobehub/lobehub" TargetMode="External"/><Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>`,
  );
  zip.file('word/media/image1.png', new Uint8Array([1, 2, 3]));
  zip.file(
    'word/footer1.xml',
    '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>LH-OFFICE-V1-DOC-FOOTER</w:t></w:r></w:p></w:ftr>',
  );
  return zip.generateAsync({ type: 'arraybuffer' });
};

describe('DOCX round-trip operations', () => {
  it('edits content and hierarchy while preserving unrelated package parts', async () => {
    let bytes = await makeFixture();
    bytes = await editDocx(bytes, {
      index: 2,
      text: '中文保真检查 ✅ — edited',
      type: 'setParagraphText',
    });
    bytes = await editDocx(bytes, { index: 2, style: 'Heading2', type: 'setParagraphStyle' });
    bytes = await editDocx(bytes, {
      column: 1,
      row: 1,
      tableIndex: 0,
      text: 'Ready',
      type: 'setTableCell',
    });
    bytes = await editDocx(bytes, {
      displayText: 'LobeHub repository',
      index: 0,
      type: 'setHyperlinkText',
    });
    bytes = await editDocx(bytes, {
      bytes: new Uint8Array([9, 8, 7]).buffer,
      index: 0,
      type: 'replaceImage',
    });
    bytes = await editDocx(bytes, {
      afterIndex: 2,
      list: 'number',
      text: 'Fourth item',
      type: 'insertParagraph',
    });

    const blocks = await inspectDocx(bytes);
    expect(blocks.map((block) => block.text).join('\n')).toContain('中文保真检查 ✅ — edited');
    expect(blocks.find((block) => block.kind === 'table')?.text).toContain('Export | Ready');
    expect(blocks.find((block) => block.text === '中文保真检查 ✅ — edited')?.style).toBe(
      'Heading2',
    );

    const zip = await JSZip.loadAsync(bytes);
    expect(await zip.file('word/document.xml')?.async('text')).toContain('LobeHub repository');
    expect(await zip.file('word/_rels/document.xml.rels')?.async('text')).toContain(
      'https://github.com/lobehub/lobehub',
    );
    expect(Array.from(await zip.file('word/media/image1.png')!.async('uint8array'))).toEqual([
      9, 8, 7,
    ]);
    expect(await zip.file('word/footer1.xml')?.async('text')).toContain('LH-OFFICE-V1-DOC-FOOTER');
  });

  it('adds paragraphs, tables, and external links without corrupting the package', async () => {
    let bytes = await makeFixture();
    bytes = await editDocx(bytes, {
      afterIndex: 1,
      text: 'Pasted body paragraph',
      type: 'insertParagraph',
    });
    bytes = await editDocx(bytes, { columns: 3, rows: 3, type: 'appendTable' });
    bytes = await editDocx(bytes, {
      displayText: 'OpenAI',
      target: 'https://openai.com/',
      type: 'appendHyperlink',
    });
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file('word/document.xml')).toBeTruthy();
    expect((await inspectDocx(bytes)).filter((block) => block.kind === 'table')).toHaveLength(2);
    expect(await zip.file('word/_rels/document.xml.rels')?.async('text')).toContain(
      'https://openai.com/',
    );
  });
});
