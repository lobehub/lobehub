import JSZip from 'jszip';

export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_R = 'http://schemas.openxmlformats.org/package/2006/relationships';

export interface DocxBlock {
  index: number;
  kind: 'paragraph' | 'table';
  style?: string;
  text: string;
}

export type DocxEditOperation =
  | { index: number; text: string; type: 'setParagraphText' }
  | { alignment: 'center' | 'left' | 'right'; index: number; type: 'setAlignment' }
  | {
      bold?: boolean;
      fontFamily?: string;
      fontSize?: number;
      index: number;
      type: 'formatParagraph';
    }
  | {
      index: number;
      style: 'Heading1' | 'Heading2' | 'Heading3' | 'Normal';
      type: 'setParagraphStyle';
    }
  | { afterIndex: number; list?: 'bullet' | 'number'; text: string; type: 'insertParagraph' }
  | { columns: number; rows: number; type: 'appendTable' }
  | { column: number; row: number; tableIndex: number; text: string; type: 'setTableCell' }
  | { displayText: string; target: string; type: 'appendHyperlink' }
  | { displayText: string; index: number; type: 'setHyperlinkText' }
  | { bytes: ArrayBuffer; index: number; type: 'replaceImage' };

const parse = (xml: string) => {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const error = document.getElementsByTagName('parsererror')[0];
  if (error) throw new Error(`Invalid DOCX XML: ${error.textContent || 'parse failed'}`);
  return document;
};
const serialize = (document: XMLDocument) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${document.documentElement.outerHTML}`;
const local = (element: Element) => element.localName.split(':').at(-1);
const all = (root: ParentNode, name: string) =>
  Array.from(root.querySelectorAll('*')).filter((element) => local(element) === name);
const direct = (root: Element, name: string) =>
  Array.from(root.children).find((element) => local(element) === name);
const child = (document: XMLDocument, parent: Element, name: string) => {
  const existing = direct(parent, name);
  if (existing) return existing;
  const element = document.createElementNS(W, `w:${name}`);
  parent.appendChild(element);
  return element;
};
const setW = (element: Element, name: string, value: string) =>
  element.setAttributeNS(W, `w:${name}`, value);
const textOf = (element: Element) =>
  all(element, 't')
    .map((node) => node.textContent || '')
    .join('');

const paragraphElements = (document: XMLDocument) => {
  const body = all(document, 'body')[0];
  return body ? Array.from(body.children).filter((element) => local(element) === 'p') : [];
};
const tableElements = (document: XMLDocument) =>
  all(document, 'body')[0]
    ? Array.from(all(document, 'body')[0].children).filter((element) => local(element) === 'tbl')
    : [];

const replaceText = (document: XMLDocument, paragraph: Element, text: string) => {
  const firstRun = all(paragraph, 'r')[0] || document.createElementNS(W, 'w:r');
  const runProperties = direct(firstRun, 'rPr')?.cloneNode(true);
  Array.from(paragraph.children)
    .filter((element) => local(element) !== 'pPr')
    .forEach((element) => element.remove());
  const run = document.createElementNS(W, 'w:r');
  if (runProperties) run.appendChild(runProperties);
  const textNode = document.createElementNS(W, 'w:t');
  textNode.setAttribute('xml:space', 'preserve');
  textNode.textContent = text;
  run.appendChild(textNode);
  paragraph.appendChild(run);
};

const nextRelationshipId = (rels: XMLDocument) => {
  const ids = Array.from(rels.getElementsByTagName('Relationship')).map((element) =>
    Number(element.getAttribute('Id')?.replace(/^rId/u, '')),
  );
  return `rId${Math.max(0, ...ids.filter(Number.isFinite)) + 1}`;
};
const relationshipId = (element: Element) =>
  element.getAttributeNS(R, 'embed') || element.getAttribute('r:embed');
const resolveTarget = (sourcePath: string, target: string) => {
  const parts = sourcePath.split('/');
  parts.pop();
  for (const part of target.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
};

const loadParts = async (bytes: ArrayBuffer) => {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml')?.async('text');
  if (!xml) throw new Error('DOCX document.xml is missing');
  return { document: parse(xml), zip };
};

export const inspectDocx = async (bytes: ArrayBuffer): Promise<DocxBlock[]> => {
  const { document } = await loadParts(bytes);
  const body = all(document, 'body')[0];
  if (!body) return [];
  let paragraphIndex = 0;
  let tableIndex = 0;
  return Array.from(body.children).flatMap((element): DocxBlock[] => {
    if (local(element) === 'p') {
      const styleElement = direct(direct(element, 'pPr') || element, 'pStyle');
      const style = styleElement?.getAttributeNS(W, 'val') || styleElement?.getAttribute('w:val');
      return [
        {
          index: paragraphIndex++,
          kind: 'paragraph',
          style: style || undefined,
          text: textOf(element),
        },
      ];
    }
    if (local(element) === 'tbl') {
      const rows = Array.from(element.children).filter((node) => local(node) === 'tr');
      const text = rows
        .map((row) =>
          Array.from(row.children)
            .filter((node) => local(node) === 'tc')
            .map(textOf)
            .join(' | '),
        )
        .join('\n');
      return [{ index: tableIndex++, kind: 'table', text }];
    }
    return [];
  });
};

export const editDocx = async (bytes: ArrayBuffer, operation: DocxEditOperation) => {
  const { document, zip } = await loadParts(bytes);
  const body = all(document, 'body')[0];
  if (!body) throw new Error('DOCX body is missing');
  const paragraphs = paragraphElements(document);

  if (operation.type === 'setParagraphText') {
    const paragraph = paragraphs[operation.index];
    if (!paragraph) throw new Error(`Paragraph ${operation.index} does not exist`);
    replaceText(document, paragraph, operation.text);
  } else if (operation.type === 'setParagraphStyle') {
    const paragraph = paragraphs[operation.index];
    if (!paragraph) throw new Error(`Paragraph ${operation.index} does not exist`);
    setW(child(document, child(document, paragraph, 'pPr'), 'pStyle'), 'val', operation.style);
  } else if (operation.type === 'setAlignment') {
    const paragraph = paragraphs[operation.index];
    if (!paragraph) throw new Error(`Paragraph ${operation.index} does not exist`);
    setW(child(document, child(document, paragraph, 'pPr'), 'jc'), 'val', operation.alignment);
  } else if (operation.type === 'formatParagraph') {
    const paragraph = paragraphs[operation.index];
    if (!paragraph) throw new Error(`Paragraph ${operation.index} does not exist`);
    for (const run of all(paragraph, 'r')) {
      const properties = child(document, run, 'rPr');
      if (operation.bold !== undefined)
        setW(child(document, properties, 'b'), 'val', operation.bold ? '1' : '0');
      if (operation.fontFamily) {
        const fonts = child(document, properties, 'rFonts');
        setW(fonts, 'ascii', operation.fontFamily);
        setW(fonts, 'hAnsi', operation.fontFamily);
        setW(fonts, 'eastAsia', operation.fontFamily);
      }
      if (operation.fontSize)
        setW(child(document, properties, 'sz'), 'val', String(operation.fontSize * 2));
    }
  } else if (operation.type === 'insertParagraph') {
    const paragraph = document.createElementNS(W, 'w:p');
    replaceText(document, paragraph, operation.text);
    if (operation.list) {
      const numPr = child(document, child(document, paragraph, 'pPr'), 'numPr');
      setW(child(document, numPr, 'ilvl'), 'val', '0');
      setW(child(document, numPr, 'numId'), 'val', operation.list === 'number' ? '5' : '1');
    }
    const reference = paragraphs[operation.afterIndex];
    if (reference) reference.after(paragraph);
    else body.insertBefore(paragraph, direct(body, 'sectPr') || null);
  } else if (operation.type === 'setTableCell') {
    const table = tableElements(document)[operation.tableIndex];
    const row =
      table && Array.from(table.children).filter((node) => local(node) === 'tr')[operation.row];
    const cell =
      row && Array.from(row.children).filter((node) => local(node) === 'tc')[operation.column];
    const paragraph = cell && all(cell, 'p')[0];
    if (!paragraph) throw new Error('Table cell does not exist');
    replaceText(document, paragraph, operation.text);
  } else if (operation.type === 'appendTable') {
    const table = document.createElementNS(W, 'w:tbl');
    const properties = child(document, table, 'tblPr');
    setW(child(document, properties, 'tblStyle'), 'val', 'TableGrid');
    for (let rowIndex = 0; rowIndex < operation.rows; rowIndex++) {
      const row = document.createElementNS(W, 'w:tr');
      for (let columnIndex = 0; columnIndex < operation.columns; columnIndex++) {
        const cell = document.createElementNS(W, 'w:tc');
        const paragraph = document.createElementNS(W, 'w:p');
        replaceText(document, paragraph, '');
        cell.appendChild(paragraph);
        row.appendChild(cell);
      }
      table.appendChild(row);
    }
    body.insertBefore(table, direct(body, 'sectPr') || null);
  } else if (operation.type === 'appendHyperlink') {
    const relsPath = 'word/_rels/document.xml.rels';
    const relsXml = await zip.file(relsPath)?.async('text');
    const rels = relsXml ? parse(relsXml) : parse(`<Relationships xmlns="${PKG_R}"/>`);
    const id = nextRelationshipId(rels);
    const relationship = rels.createElementNS(PKG_R, 'Relationship');
    relationship.setAttribute('Id', id);
    relationship.setAttribute(
      'Type',
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
    );
    relationship.setAttribute('Target', operation.target);
    relationship.setAttribute('TargetMode', 'External');
    rels.documentElement.appendChild(relationship);
    const paragraph = document.createElementNS(W, 'w:p');
    const hyperlink = document.createElementNS(W, 'w:hyperlink');
    hyperlink.setAttributeNS(R, 'r:id', id);
    const run = document.createElementNS(W, 'w:r');
    const text = document.createElementNS(W, 'w:t');
    text.textContent = operation.displayText;
    run.appendChild(text);
    hyperlink.appendChild(run);
    paragraph.appendChild(hyperlink);
    body.insertBefore(paragraph, direct(body, 'sectPr') || null);
    zip.file(relsPath, serialize(rels));
  } else if (operation.type === 'setHyperlinkText') {
    const hyperlink = all(document, 'hyperlink')[operation.index];
    if (!hyperlink) throw new Error(`Hyperlink ${operation.index} does not exist`);
    const paragraph = hyperlink.parentElement;
    if (!paragraph) throw new Error('Hyperlink paragraph is malformed');
    const run = all(hyperlink, 'r')[0] || document.createElementNS(W, 'w:r');
    const text = all(run, 't')[0] || document.createElementNS(W, 'w:t');
    text.textContent = operation.displayText;
    if (!text.parentElement) run.appendChild(text);
    if (!run.parentElement) hyperlink.appendChild(run);
  } else if (operation.type === 'replaceImage') {
    const blip = all(document, 'blip')[operation.index];
    const id = blip && relationshipId(blip);
    if (!id) throw new Error(`Image ${operation.index} does not exist`);
    const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('text');
    if (!relsXml) throw new Error('DOCX document relationships are missing');
    const rels = parse(relsXml);
    const relationship = Array.from(rels.getElementsByTagName('Relationship')).find(
      (element) => element.getAttribute('Id') === id,
    );
    const target = relationship?.getAttribute('Target');
    if (!target) throw new Error(`Image relationship ${id} is missing`);
    zip.file(resolveTarget('word/document.xml', target), operation.bytes);
  }

  zip.file('word/document.xml', serialize(document));
  return zip.generateAsync({ type: 'arraybuffer' });
};
