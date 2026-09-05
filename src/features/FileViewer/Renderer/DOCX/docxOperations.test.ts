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

  it('deletes paragraphs and tables and keeps the body non-empty', async () => {
    let bytes = await makeFixture();
    bytes = await editDocx(bytes, { index: 0, kind: 'table', type: 'deleteBlock' });
    bytes = await editDocx(bytes, { index: 2, kind: 'paragraph', type: 'deleteBlock' });
    const blocks = await inspectDocx(bytes);
    expect(blocks.filter((block) => block.kind === 'table')).toHaveLength(0);
    expect(blocks.map((block) => block.text)).not.toContain('中文保真检查 ✅');

    // Deleting everything must still leave one valid paragraph behind.
    let remaining = blocks.filter((block) => block.kind === 'paragraph').length;
    while (remaining > 0) {
      bytes = await editDocx(bytes, { index: 0, kind: 'paragraph', type: 'deleteBlock' });
      remaining--;
    }
    const emptied = await inspectDocx(bytes);
    expect(emptied).toHaveLength(1);
    expect(emptied[0]).toMatchObject({ kind: 'paragraph', text: '' });
  });

  it('toggles lists and materializes numbering definitions for Word', async () => {
    let bytes = await makeFixture();
    bytes = await editDocx(bytes, { index: 2, list: 'number', type: 'setParagraphList' });
    bytes = await editDocx(bytes, {
      afterIndex: 2,
      list: 'bullet',
      text: 'Bullet item',
      type: 'insertParagraph',
    });

    let blocks = await inspectDocx(bytes);
    expect(blocks.find((block) => block.text === '中文保真检查 ✅')?.list).toBe('number');
    expect(blocks.find((block) => block.text === 'Bullet item')?.list).toBe('bullet');

    const zip = await JSZip.loadAsync(bytes);
    const numbering = await zip.file('word/numbering.xml')?.async('text');
    expect(numbering).toContain('w:numFmt w:val="decimal"');
    expect(numbering).toContain('w:numFmt w:val="bullet"');
    expect(await zip.file('[Content_Types].xml')?.async('text')).toContain('/word/numbering.xml');
    expect(await zip.file('word/_rels/document.xml.rels')?.async('text')).toContain(
      'numbering.xml',
    );

    bytes = await editDocx(bytes, { index: 2, list: null, type: 'setParagraphList' });
    blocks = await inspectDocx(bytes);
    expect(blocks.find((block) => block.text === '中文保真检查 ✅')?.list).toBeUndefined();
  });

  it('inserts a new PNG image with media part, relationship, and content type', async () => {
    // Minimal 2x3 PNG header: signature + IHDR width=2 height=3.
    const png = new Uint8Array(32);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
    new DataView(png.buffer).setUint32(16, 2);
    new DataView(png.buffer).setUint32(20, 3);

    const bytes = await editDocx(await makeFixture(), {
      afterIndex: 2,
      bytes: png.buffer,
      type: 'insertImage',
    });
    const zip = await JSZip.loadAsync(bytes);
    const media = Object.keys(zip.files).filter(
      (name) => name.startsWith('word/media/') && !name.endsWith('/'),
    );
    expect(media.length).toBe(2);
    const rels = await zip.file('word/_rels/document.xml.rels')?.async('text');
    expect(rels).toContain('media/lobehub-image-');
    expect(await zip.file('[Content_Types].xml')?.async('text')).toContain('image/png');
    const documentXml = await zip.file('word/document.xml')?.async('text');
    expect(documentXml).toContain('wp:inline');
    expect(documentXml).toContain(`cx="${2 * 9525}" cy="${3 * 9525}"`);

    const blocks = await inspectDocx(bytes);
    const withImage = blocks.filter((block) => block.images?.length);
    expect(withImage.length).toBeGreaterThanOrEqual(1);
    expect(withImage.at(-1)?.images?.[0].src).toMatch(/^data:image\/png;base64,/);
  });

  it('encodes multi-line text as w:br and reads it back losslessly', async () => {
    const bytes = await editDocx(await makeFixture(), {
      index: 2,
      text: 'line one\nline two',
      type: 'setParagraphText',
    });
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file('word/document.xml')?.async('text');
    expect(documentXml).toContain('<w:br');
    expect(documentXml).not.toContain('line one\nline two');
    expect((await inspectDocx(bytes))[2].text).toBe('line one\nline two');
  });

  it('reports formatting state so the toolbar can toggle it', async () => {
    let bytes = await makeFixture();
    bytes = await editDocx(bytes, { alignment: 'justify', index: 2, type: 'setAlignment' });
    bytes = await editDocx(bytes, {
      fontFamily: 'Georgia',
      fontSize: 14,
      index: 2,
      type: 'formatParagraph',
    });
    const blocks = await inspectDocx(bytes);
    expect(blocks[2]).toMatchObject({
      alignment: 'justify',
      fontFamily: 'Georgia',
      fontSize: 14,
    });
    expect(blocks[1].bold).toBe(true);
    const linkBlock = blocks.find((block) => block.link);
    expect(linkBlock?.link).toMatchObject({
      index: 0,
      target: 'https://github.com/lobehub/lobehub',
    });
  });

  it('styles appended hyperlinks so they render as links without a style part', async () => {
    const bytes = await editDocx(await makeFixture(), {
      displayText: 'OpenAI',
      target: 'https://openai.com/',
      type: 'appendHyperlink',
    });
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = (await zip.file('word/document.xml')?.async('text')) || '';
    const appended = documentXml.slice(documentXml.indexOf('OpenAI') - 400);
    expect(appended).toContain('w:color');
    expect(appended).toContain('0563C1');
    expect(appended).toContain('w:u');
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
