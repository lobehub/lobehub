import JSZip from 'jszip';

export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_R = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';

export type DocxAlignment = 'center' | 'justify' | 'left' | 'right';
export type DocxListKind = 'bullet' | 'number';

export interface DocxImageRef {
  /** Global drawing index across the document, addressing `replaceImage`. */
  index: number;
  /** data: URL for inline preview. */
  src: string;
}

export interface DocxBlock {
  alignment?: DocxAlignment;
  bold?: boolean;
  fontFamily?: string;
  fontSize?: number;
  images?: DocxImageRef[];
  index: number;
  kind: 'paragraph' | 'table';
  link?: { index: number; target?: string };
  list?: DocxListKind;
  style?: string;
  text: string;
}

export type DocxEditOperation =
  | { index: number; text: string; type: 'setParagraphText' }
  | { alignment: DocxAlignment; index: number; type: 'setAlignment' }
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
  | { afterIndex: number; list?: DocxListKind; text: string; type: 'insertParagraph' }
  | { index: number; kind: 'paragraph' | 'table'; type: 'deleteBlock' }
  | { index: number; list: DocxListKind | null; type: 'setParagraphList' }
  | { columns: number; rows: number; type: 'appendTable' }
  | { column: number; row: number; tableIndex: number; text: string; type: 'setTableCell' }
  | { displayText: string; target: string; type: 'appendHyperlink' }
  | { displayText: string; index: number; type: 'setHyperlinkText' }
  | { bytes: ArrayBuffer; index: number; type: 'replaceImage' }
  | { afterIndex?: number; bytes: ArrayBuffer; type: 'insertImage' };

const parse = (xml: string) => {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const error = document.getElementsByTagName('parsererror')[0];
  if (error) throw new Error(`Invalid DOCX XML: ${error.textContent || 'parse failed'}`);
  return document;
};
// XMLSerializer, not outerHTML: HTML serialization emits void elements such as
// `w:br` without a closing tag, producing unparseable part XML.
const serialize = (document: XMLDocument) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${new XMLSerializer().serializeToString(
    document.documentElement,
  )}`;
const local = (element: Element) => element.localName.split(':').at(-1);
const all = (root: ParentNode, name: string) =>
  Array.from(root.querySelectorAll('*')).filter((element) => local(element) === name);
const direct = (root: Element, name: string) =>
  Array.from(root.children).find((element) => local(element) === name);

/**
 * pPr enforces a child sequence; Word repairs unordered files but flags them.
 * Members not listed sort last in-order of insertion.
 */
const P_PR_ORDER = ['pStyle', 'numPr', 'spacing', 'ind', 'jc', 'rPr'];
const insertOrdered = (parent: Element, element: Element, order: string[]) => {
  const rank = order.indexOf(local(element) || '');
  if (rank === -1) {
    parent.appendChild(element);
    return;
  }
  const next = Array.from(parent.children).find((sibling) => {
    const siblingRank = order.indexOf(local(sibling) || '');
    return siblingRank === -1 || siblingRank > rank;
  });
  parent.insertBefore(element, next || null);
};
const child = (document: XMLDocument, parent: Element, name: string) => {
  const existing = direct(parent, name);
  if (existing) return existing;
  const element = document.createElementNS(W, `w:${name}`);
  if (local(parent) === 'pPr') insertOrdered(parent, element, P_PR_ORDER);
  else parent.appendChild(element);
  return element;
};
const setW = (element: Element, name: string, value: string) =>
  element.setAttributeNS(W, `w:${name}`, value);
const getW = (element: Element | undefined, name: string) =>
  element?.getAttributeNS(W, name) || element?.getAttribute(`w:${name}`) || undefined;
/** Reads visible text, mapping `w:br`/`w:cr` back to newlines. */
const textOf = (element: Element) =>
  Array.from(element.querySelectorAll('*'))
    .map((node) => {
      const name = local(node);
      if (name === 't') return node.textContent || '';
      if (name === 'br' || name === 'cr') return '\n';
      return '';
    })
    .join('');

const paragraphElements = (document: XMLDocument) => {
  const body = all(document, 'body')[0];
  return body ? Array.from(body.children).filter((element) => local(element) === 'p') : [];
};
const tableElements = (document: XMLDocument) =>
  all(document, 'body')[0]
    ? Array.from(all(document, 'body')[0].children).filter((element) => local(element) === 'tbl')
    : [];

/** Word ignores raw newlines inside `w:t`; encode them as explicit `w:br` runs. */
const fillRunText = (document: XMLDocument, run: Element, text: string) => {
  text.split('\n').forEach((line, lineIndex) => {
    if (lineIndex > 0) run.appendChild(document.createElementNS(W, 'w:br'));
    if (!line && lineIndex > 0) return;
    const textNode = document.createElementNS(W, 'w:t');
    textNode.setAttribute('xml:space', 'preserve');
    textNode.textContent = line;
    run.appendChild(textNode);
  });
};

const replaceText = (document: XMLDocument, paragraph: Element, text: string) => {
  const firstRun = all(paragraph, 'r')[0] || document.createElementNS(W, 'w:r');
  const runProperties = direct(firstRun, 'rPr')?.cloneNode(true);
  Array.from(paragraph.children)
    .filter((element) => local(element) !== 'pPr')
    .forEach((element) => element.remove());
  const run = document.createElementNS(W, 'w:r');
  if (runProperties) run.appendChild(runProperties);
  fillRunText(document, run, text);
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

const RELS_PATH = 'word/_rels/document.xml.rels';
const loadRels = async (zip: JSZip) => {
  const xml = await zip.file(RELS_PATH)?.async('text');
  return xml ? parse(xml) : parse(`<Relationships xmlns="${PKG_R}"/>`);
};
const addRelationship = (rels: XMLDocument, type: string, target: string, external?: boolean) => {
  const id = nextRelationshipId(rels);
  const relationship = rels.createElementNS(PKG_R, 'Relationship');
  relationship.setAttribute('Id', id);
  relationship.setAttribute('Type', type);
  relationship.setAttribute('Target', target);
  if (external) relationship.setAttribute('TargetMode', 'External');
  rels.documentElement.appendChild(relationship);
  return id;
};

const CONTENT_TYPES_PATH = '[Content_Types].xml';
const ensureContentType = async (
  zip: JSZip,
  entry: { extension: string; type: string } | { partName: string; type: string },
) => {
  const xml = await zip.file(CONTENT_TYPES_PATH)?.async('text');
  const types = xml ? parse(xml) : parse(`<Types xmlns="${CT}"/>`);
  const isDefault = 'extension' in entry;
  const tag = isDefault ? 'Default' : 'Override';
  const attribute = isDefault ? 'Extension' : 'PartName';
  const value = isDefault ? entry.extension : entry.partName;
  const exists = Array.from(types.getElementsByTagName(tag)).some(
    (element) => element.getAttribute(attribute)?.toLowerCase() === value.toLowerCase(),
  );
  if (!exists) {
    const element = types.createElementNS(CT, tag);
    element.setAttribute(attribute, value);
    element.setAttribute('ContentType', entry.type);
    types.documentElement.appendChild(element);
    zip.file(CONTENT_TYPES_PATH, serialize(types));
  }
};

/**
 * Our list toggles reference these numbering ids. High values keep clear of the
 * ids Word itself allocates in imported documents.
 */
const LIST_NUM_IDS: Record<DocxListKind, number> = { bullet: 1001, number: 1002 };
const NUMBERING_PATH = 'word/numbering.xml';

/**
 * Numbering elements are built with createElementNS: parsing prefixed XML
 * fragments and importing them loses namespace bindings in some DOM
 * implementations (happy-dom drops the w: prefix mapping entirely).
 */
const wElement = (
  document: XMLDocument,
  name: string,
  attributes: Record<string, string> = {},
  children: Element[] = [],
) => {
  const element = document.createElementNS(W, `w:${name}`);
  for (const [key, value] of Object.entries(attributes)) setW(element, key, value);
  for (const node of children) element.appendChild(node);
  return element;
};

const BULLET_CHAR = '\uF0B7';
const abstractNumElement = (document: XMLDocument, abstractId: number, kind: DocxListKind) => {
  const format =
    kind === 'bullet'
      ? [
          wElement(document, 'numFmt', { val: 'bullet' }),
          wElement(document, 'lvlText', { val: BULLET_CHAR }),
          wElement(document, 'rPr', {}, [
            wElement(document, 'rFonts', { ascii: 'Symbol', hAnsi: 'Symbol', hint: 'default' }),
          ]),
        ]
      : [
          wElement(document, 'numFmt', { val: 'decimal' }),
          wElement(document, 'lvlText', { val: '%1.' }),
        ];
  return wElement(document, 'abstractNum', { abstractNumId: String(abstractId) }, [
    wElement(document, 'multiLevelType', { val: 'singleLevel' }),
    wElement(document, 'lvl', { ilvl: '0' }, [
      wElement(document, 'start', { val: '1' }),
      ...format,
      wElement(document, 'lvlJc', { val: 'left' }),
      wElement(document, 'pPr', {}, [wElement(document, 'ind', { hanging: '360', left: '720' })]),
    ]),
  ]);
};

/**
 * Guarantees `word/numbering.xml` defines the numbering id for `kind`. Without
 * a matching definition Word silently drops list markers on open — the classic
 * "my bullets disappeared" fidelity bug.
 */
const ensureNumbering = async (zip: JSZip, kind: DocxListKind) => {
  const numId = LIST_NUM_IDS[kind];
  const xml = await zip.file(NUMBERING_PATH)?.async('text');
  const numbering = xml ? parse(xml) : parse(`<w:numbering xmlns:w="${W}"/>`);
  const root = numbering.documentElement;
  const hasNum = all(root, 'num').some((element) => getW(element, 'numId') === String(numId));
  if (!hasNum) {
    const existingAbstractIds = all(root, 'abstractNum')
      .map((element) => Number(getW(element, 'abstractNumId')))
      .filter(Number.isFinite);
    const abstractId = Math.max(numId - 1, ...existingAbstractIds) + 1;
    // abstractNum entries must precede every num entry.
    root.insertBefore(abstractNumElement(numbering, abstractId, kind), all(root, 'num')[0] || null);
    root.appendChild(
      wElement(numbering, 'num', { numId: String(numId) }, [
        wElement(numbering, 'abstractNumId', { val: String(abstractId) }),
      ]),
    );
  }
  if (!xml || !hasNum) zip.file(NUMBERING_PATH, serialize(numbering));

  await ensureContentType(zip, {
    partName: `/${NUMBERING_PATH}`,
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml',
  });
  const rels = await loadRels(zip);
  const hasRel = Array.from(rels.getElementsByTagName('Relationship')).some(
    (element) => element.getAttribute('Target') === 'numbering.xml',
  );
  if (!hasRel) {
    addRelationship(
      rels,
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',
      'numbering.xml',
    );
    zip.file(RELS_PATH, serialize(rels));
  }
  return numId;
};

const IMAGE_KINDS = {
  jpeg: { extension: 'jpeg', mime: 'image/jpeg' },
  png: { extension: 'png', mime: 'image/png' },
} as const;

const sniffImage = (bytes: ArrayBuffer) => {
  const view = new DataView(bytes);
  if (view.byteLength > 24 && view.getUint32(0) === 0x89_50_4e_47)
    return { ...IMAGE_KINDS.png, height: view.getUint32(20), width: view.getUint32(16) };
  if (view.byteLength > 4 && view.getUint16(0) === 0xff_d8) {
    let offset = 2;
    while (offset + 9 < view.byteLength) {
      if (view.getUint8(offset) !== 0xff) break;
      const marker = view.getUint8(offset + 1);
      const size = view.getUint16(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return {
          ...IMAGE_KINDS.jpeg,
          height: view.getUint16(offset + 5),
          width: view.getUint16(offset + 7),
        };
      offset += 2 + size;
    }
    return { ...IMAGE_KINDS.jpeg, height: 300, width: 400 };
  }
  throw new Error('Only PNG and JPEG images are supported');
};

const EMU_PER_PIXEL = 9525;
/** Keep inserted pictures inside a letter page's ~6in text column. */
const MAX_IMAGE_WIDTH_EMU = 5_486_400;

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

const nsElement = (
  document: XMLDocument,
  namespace: string,
  qualifiedName: string,
  attributes: Record<string, string> = {},
  children: Element[] = [],
) => {
  const element = document.createElementNS(namespace, qualifiedName);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  for (const node of children) element.appendChild(node);
  return element;
};

const drawingParagraph = (
  document: XMLDocument,
  relId: string,
  docPrId: number,
  cx: number,
  cy: number,
) => {
  const size = { cx: String(cx), cy: String(cy) };
  const blip = nsElement(document, A, 'a:blip');
  blip.setAttributeNS(R, 'r:embed', relId);
  const inline = nsElement(
    document,
    WP,
    'wp:inline',
    { distB: '0', distL: '0', distR: '0', distT: '0' },
    [
      nsElement(document, WP, 'wp:extent', size),
      nsElement(document, WP, 'wp:docPr', { id: String(docPrId), name: `Picture ${docPrId}` }),
      nsElement(document, A, 'a:graphic', {}, [
        nsElement(document, A, 'a:graphicData', { uri: PIC }, [
          nsElement(document, PIC, 'pic:pic', {}, [
            nsElement(document, PIC, 'pic:nvPicPr', {}, [
              nsElement(document, PIC, 'pic:cNvPr', {
                id: String(docPrId),
                name: `Picture ${docPrId}`,
              }),
              nsElement(document, PIC, 'pic:cNvPicPr'),
            ]),
            nsElement(document, PIC, 'pic:blipFill', {}, [
              blip,
              nsElement(document, A, 'a:stretch', {}, [nsElement(document, A, 'a:fillRect')]),
            ]),
            nsElement(document, PIC, 'pic:spPr', {}, [
              nsElement(document, A, 'a:xfrm', {}, [
                nsElement(document, A, 'a:off', { x: '0', y: '0' }),
                nsElement(document, A, 'a:ext', size),
              ]),
              nsElement(document, A, 'a:prstGeom', { prst: 'rect' }, [
                nsElement(document, A, 'a:avLst'),
              ]),
            ]),
          ]),
        ]),
      ]),
    ],
  );
  return wElement(document, 'p', {}, [
    wElement(document, 'r', {}, [wElement(document, 'drawing', {}, [inline])]),
  ]);
};

const loadParts = async (bytes: ArrayBuffer) => {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml')?.async('text');
  if (!xml) throw new Error('DOCX document.xml is missing');
  return { document: parse(xml), zip };
};

const numberingFormats = async (zip: JSZip) => {
  const formats = new Map<string, DocxListKind>();
  const xml = await zip.file(NUMBERING_PATH)?.async('text');
  if (!xml) return formats;
  const numbering = parse(xml);
  const abstractFormats = new Map<string, DocxListKind>();
  for (const abstract of all(numbering, 'abstractNum')) {
    const id = getW(abstract, 'abstractNumId');
    const format = getW(all(abstract, 'numFmt')[0], 'val');
    if (id) abstractFormats.set(id, format === 'bullet' ? 'bullet' : 'number');
  }
  for (const num of all(numbering, 'num')) {
    const numId = getW(num, 'numId');
    const abstractId = getW(direct(num, 'abstractNumId'), 'val');
    const kind = abstractId === undefined ? undefined : abstractFormats.get(abstractId);
    if (numId && kind) formats.set(numId, kind);
  }
  return formats;
};

const relationshipTargets = (rels: XMLDocument) => {
  const targets = new Map<string, string>();
  for (const element of Array.from(rels.getElementsByTagName('Relationship'))) {
    const id = element.getAttribute('Id');
    const target = element.getAttribute('Target');
    if (id && target) targets.set(id, target);
  }
  return targets;
};

const imageMime = (target: string) => {
  const extension = target.split('.').at(-1)?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'bmp') return 'image/bmp';
  if (extension === 'svg') return 'image/svg+xml';
  return 'image/png';
};

export const inspectDocx = async (bytes: ArrayBuffer): Promise<DocxBlock[]> => {
  const { document, zip } = await loadParts(bytes);
  const body = all(document, 'body')[0];
  if (!body) return [];
  const listFormats = await numberingFormats(zip);
  const targets = relationshipTargets(await loadRels(zip));
  let paragraphIndex = 0;
  let tableIndex = 0;
  let hyperlinkIndex = 0;
  let drawingIndex = 0;
  const blocks: DocxBlock[] = [];
  for (const element of Array.from(body.children)) {
    if (local(element) === 'p') {
      const properties = direct(element, 'pPr');
      const styleElement = properties && direct(properties, 'pStyle');
      const alignmentValue = properties && getW(direct(properties, 'jc'), 'val');
      const numPr = properties && direct(properties, 'numPr');
      const numId = numPr && getW(direct(numPr, 'numId'), 'val');
      const firstRunProperties = direct(all(element, 'r')[0] || element, 'rPr');
      const boldElement = firstRunProperties && direct(firstRunProperties, 'b');
      const fontsElement = firstRunProperties && direct(firstRunProperties, 'rFonts');
      const sizeValue = firstRunProperties && getW(direct(firstRunProperties, 'sz'), 'val');

      const images: DocxImageRef[] = [];
      for (const blip of all(element, 'blip')) {
        const index = drawingIndex++;
        const id = relationshipId(blip);
        const target = id ? targets.get(id) : undefined;
        if (!target) continue;
        const file = zip.file(resolveTarget('word/document.xml', target));
        if (!file) continue;
        const base64 = await file.async('base64');
        images.push({ index, src: `data:${imageMime(target)};base64,${base64}` });
      }

      const hyperlink = all(element, 'hyperlink')[0];
      let link: DocxBlock['link'];
      if (hyperlink) {
        const id = hyperlink.getAttributeNS(R, 'id') || hyperlink.getAttribute('r:id');
        link = { index: hyperlinkIndex, target: id ? targets.get(id) : undefined };
      }
      hyperlinkIndex += all(element, 'hyperlink').length;

      blocks.push({
        alignment:
          alignmentValue === 'both'
            ? 'justify'
            : (['center', 'left', 'right'].find((value) => value === alignmentValue) as
                DocxAlignment | undefined),
        bold: boldElement ? getW(boldElement, 'val') !== '0' : undefined,
        fontFamily: fontsElement ? getW(fontsElement, 'ascii') : undefined,
        fontSize: sizeValue ? Number(sizeValue) / 2 : undefined,
        images: images.length > 0 ? images : undefined,
        index: paragraphIndex++,
        kind: 'paragraph',
        link,
        list: numId ? listFormats.get(numId) || 'bullet' : undefined,
        style: getW(styleElement, 'val'),
        text: textOf(element),
      });
    } else if (local(element) === 'tbl') {
      hyperlinkIndex += all(element, 'hyperlink').length;
      drawingIndex += all(element, 'blip').length;
      const rows = Array.from(element.children).filter((node) => local(node) === 'tr');
      const text = rows
        .map((row) =>
          Array.from(row.children)
            .filter((node) => local(node) === 'tc')
            .map(textOf)
            .join(' | '),
        )
        .join('\n');
      blocks.push({ index: tableIndex++, kind: 'table', text });
    }
  }
  return blocks;
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
    const value = operation.alignment === 'justify' ? 'both' : operation.alignment;
    setW(child(document, child(document, paragraph, 'pPr'), 'jc'), 'val', value);
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
      const numId = await ensureNumbering(zip, operation.list);
      const numPr = child(document, child(document, paragraph, 'pPr'), 'numPr');
      setW(child(document, numPr, 'ilvl'), 'val', '0');
      setW(child(document, numPr, 'numId'), 'val', String(numId));
    }
    const reference = paragraphs[operation.afterIndex];
    if (reference) reference.after(paragraph);
    else body.insertBefore(paragraph, direct(body, 'sectPr') || null);
  } else if (operation.type === 'deleteBlock') {
    const element =
      operation.kind === 'paragraph'
        ? paragraphs[operation.index]
        : tableElements(document)[operation.index];
    if (!element) throw new Error(`${operation.kind} ${operation.index} does not exist`);
    element.remove();
    // An empty body breaks Word; keep at least one paragraph alive.
    const remaining = Array.from(body.children).filter(
      (node) => local(node) === 'p' || local(node) === 'tbl',
    );
    if (remaining.length === 0)
      body.insertBefore(document.createElementNS(W, 'w:p'), direct(body, 'sectPr') || null);
  } else if (operation.type === 'setParagraphList') {
    const paragraph = paragraphs[operation.index];
    if (!paragraph) throw new Error(`Paragraph ${operation.index} does not exist`);
    if (operation.list === null) {
      direct(direct(paragraph, 'pPr') || paragraph, 'numPr')?.remove();
    } else {
      const numId = await ensureNumbering(zip, operation.list);
      const numPr = child(document, child(document, paragraph, 'pPr'), 'numPr');
      setW(child(document, numPr, 'ilvl'), 'val', '0');
      setW(child(document, numPr, 'numId'), 'val', String(numId));
    }
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
    const rels = await loadRels(zip);
    const id = addRelationship(
      rels,
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
      operation.target,
      true,
    );
    const paragraph = document.createElementNS(W, 'w:p');
    const hyperlink = document.createElementNS(W, 'w:hyperlink');
    hyperlink.setAttributeNS(R, 'r:id', id);
    const run = document.createElementNS(W, 'w:r');
    // Direct formatting keeps the link visibly a link even when the source
    // document ships no Hyperlink character style.
    const runProperties = document.createElementNS(W, 'w:rPr');
    setW(child(document, runProperties, 'color'), 'val', '0563C1');
    setW(child(document, runProperties, 'u'), 'val', 'single');
    run.appendChild(runProperties);
    const text = document.createElementNS(W, 'w:t');
    text.textContent = operation.displayText;
    run.appendChild(text);
    hyperlink.appendChild(run);
    paragraph.appendChild(hyperlink);
    body.insertBefore(paragraph, direct(body, 'sectPr') || null);
    zip.file(RELS_PATH, serialize(rels));
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
    const relsXml = await zip.file(RELS_PATH)?.async('text');
    if (!relsXml) throw new Error('DOCX document relationships are missing');
    const rels = parse(relsXml);
    const relationship = Array.from(rels.getElementsByTagName('Relationship')).find(
      (element) => element.getAttribute('Id') === id,
    );
    const target = relationship?.getAttribute('Target');
    if (!target) throw new Error(`Image relationship ${id} is missing`);
    zip.file(resolveTarget('word/document.xml', target), operation.bytes);
  } else if (operation.type === 'insertImage') {
    const info = sniffImage(operation.bytes);
    let cx = info.width * EMU_PER_PIXEL;
    let cy = info.height * EMU_PER_PIXEL;
    if (cx > MAX_IMAGE_WIDTH_EMU) {
      cy = Math.round((cy * MAX_IMAGE_WIDTH_EMU) / cx);
      cx = MAX_IMAGE_WIDTH_EMU;
    }
    await ensureContentType(zip, { extension: info.extension, type: info.mime });
    const mediaNames = Object.keys(zip.files).filter(
      (name) => name.startsWith('word/media/') && !name.endsWith('/'),
    );
    let sequence = mediaNames.length + 1;
    while (zip.file(`word/media/lobehub-image-${sequence}.${info.extension}`)) sequence++;
    const mediaName = `word/media/lobehub-image-${sequence}.${info.extension}`;
    zip.file(mediaName, operation.bytes);
    const rels = await loadRels(zip);
    const relId = addRelationship(
      rels,
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
      mediaName.replace('word/', ''),
    );
    zip.file(RELS_PATH, serialize(rels));
    const docPrId = all(document, 'docPr').length + all(document, 'drawing').length + 1000;
    const paragraph = drawingParagraph(document, relId, docPrId, cx, cy);
    const reference =
      operation.afterIndex === undefined ? undefined : paragraphs[operation.afterIndex];
    if (reference) reference.after(paragraph);
    else body.insertBefore(paragraph, direct(body, 'sectPr') || null);
  }

  zip.file('word/document.xml', serialize(document));
  return zip.generateAsync({ compression: 'DEFLATE', type: 'arraybuffer' });
};
