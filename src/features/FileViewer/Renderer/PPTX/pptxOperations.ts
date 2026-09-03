import JSZip from 'jszip';

const namespaces = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  c: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
};

const relationshipNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships';

export interface PptxChartData {
  categories: string[];
  values: number[];
}

export interface PptxElementFrame {
  h: number;
  w: number;
  x: number;
  y: number;
}

export type PptxEditOperation =
  | { frame: PptxElementFrame; nodeId: string; slideIndex: number; type: 'setFrame' }
  | { nodeId: string; slideIndex: number; text: string; type: 'setText' }
  | {
      align?: 'ctr' | 'l' | 'r';
      bold?: boolean;
      color?: string;
      fontSize?: number;
      nodeId: string;
      slideIndex: number;
      type: 'formatText';
    }
  | { nodeId: string; slideIndex: number; type: 'deleteElement' }
  | { frame: PptxElementFrame; slideIndex: number; text: string; type: 'addText' }
  | {
      fill: string;
      frame: PptxElementFrame;
      shape: 'ellipse' | 'rect' | 'roundRect';
      slideIndex: number;
      type: 'addShape';
    }
  | { chart: PptxChartData; nodeId: string; slideIndex: number; type: 'setChartData' }
  | { chart: PptxChartData; frame: PptxElementFrame; slideIndex: number; type: 'addChart' }
  | { fromIndex: number; toIndex: number; type: 'moveSlide' }
  | { slideIndex: number; type: 'duplicateSlide' }
  | { slideIndex: number; type: 'deleteSlide' }
  | { layoutPath: string; slideIndex: number; type: 'setSlideLayout' };

export interface AddImageOperation {
  bytes: ArrayBuffer;
  fileName: string;
  frame: PptxElementFrame;
  mimeType: string;
  slideIndex: number;
  type: 'addImage';
}

const parseXml = (xml: string) => {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const error = document.getElementsByTagName('parsererror')[0];
  if (error) throw new Error(`Invalid PPTX XML: ${error.textContent || 'parse failed'}`);
  return document;
};

const serializeXml = (document: XMLDocument) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${document.documentElement.outerHTML}`;

const localNameOf = (node: Element | Attr) => node.localName.split(':').at(-1);

const elementsByLocalName = (root: ParentNode, name: string): Element[] =>
  Array.from(root.querySelectorAll('*')).filter((element) => localNameOf(element) === name);

const firstByLocalName = (root: ParentNode, name: string) => elementsByLocalName(root, name)[0];

const directChild = (root: Element, name: string) =>
  Array.from(root.children).find((element) => localNameOf(element) === name);

const normalizeHex = (value: string) => value.replace(/^#/u, '').toUpperCase().slice(0, 6);

const resolveTarget = (sourcePath: string, target: string) => {
  if (target.startsWith('/')) return target.slice(1);
  const segments = sourcePath.split('/');
  segments.pop();
  for (const segment of target.split('/')) {
    if (segment === '..') segments.pop();
    else if (segment !== '.') segments.push(segment);
  }
  return segments.join('/');
};

const relativeTarget = (sourcePath: string, targetPath: string) => {
  const source = sourcePath.split('/');
  source.pop();
  const target = targetPath.split('/');
  while (source[0] === target[0]) {
    source.shift();
    target.shift();
  }
  return `${source.map(() => '..').join('/')}${source.length ? '/' : ''}${target.join('/')}`;
};

const relsPathFor = (partPath: string) => {
  const segments = partPath.split('/');
  const name = segments.pop();
  return `${segments.join('/')}/_rels/${name}.rels`;
};

const nextRelationshipId = (rels: XMLDocument) => {
  const ids = Array.from(rels.getElementsByTagName('Relationship')).map((relationship) =>
    Number(relationship.getAttribute('Id')?.replace(/^rId/u, '')),
  );
  return `rId${Math.max(0, ...ids.filter(Number.isFinite)) + 1}`;
};

const relationshipDocument = () => parseXml(`<Relationships xmlns="${relationshipNamespace}"/>`);

const relationshipIdOf = (element: Element) =>
  element.outerHTML.match(/\br:id=["']([^"']+)["']/u)?.[1] ||
  element.getAttributeNS(namespaces.r, 'id') ||
  element.getAttribute('r:id') ||
  Array.from(element.attributes).find((attribute) => attribute.name === 'r:id')?.value ||
  Array.from(element.attributes)
    .reverse()
    .find((attribute) => localNameOf(attribute) === 'id')?.value ||
  null;

const appendRelationship = (
  rels: XMLDocument,
  target: string,
  type: string,
  requestedId?: string,
) => {
  const relationship = rels.createElementNS(relationshipNamespace, 'Relationship');
  const id = requestedId || nextRelationshipId(rels);
  relationship.setAttribute('Id', id);
  relationship.setAttribute('Target', target);
  relationship.setAttribute('Type', type);
  rels.documentElement.appendChild(relationship);
  return id;
};

const presentationSlidePaths = async (zip: JSZip) => {
  const presentationXml = await zip.file('ppt/presentation.xml')?.async('text');
  const relsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('text');
  if (!presentationXml || !relsXml) throw new Error('PPTX presentation metadata is missing');
  const presentation = parseXml(presentationXml);
  const rels = parseXml(relsXml);
  const targets = new Map(
    Array.from(rels.getElementsByTagName('Relationship')).map((relationship) => [
      relationship.getAttribute('Id'),
      relationship.getAttribute('Target'),
    ]),
  );
  const slideIds = elementsByLocalName(presentation, 'sldId');
  const paths = slideIds.map((slideId) => {
    const id = relationshipIdOf(slideId);
    const target = targets.get(id);
    if (!target) throw new Error(`Slide relationship ${id || '(missing)'} is invalid`);
    return resolveTarget('ppt/presentation.xml', target);
  });
  return { paths, presentation, rels, slideIds };
};

const getSlide = async (zip: JSZip, slideIndex: number) => {
  const metadata = await presentationSlidePaths(zip);
  const path = metadata.paths[slideIndex];
  if (!path) throw new Error(`Slide ${slideIndex + 1} does not exist`);
  const xml = await zip.file(path)?.async('text');
  if (!xml) throw new Error(`Slide part ${path} is missing`);
  return { ...metadata, document: parseXml(xml), path };
};

const materializePlaceholderTransforms = async (zip: JSZip) => {
  const { paths } = await presentationSlidePaths(zip);
  let changed = false;
  for (const slidePath of paths) {
    const slideXml = await zip.file(slidePath)?.async('text');
    const relsXml = await zip.file(relsPathFor(slidePath))?.async('text');
    if (!slideXml || !relsXml) continue;
    const rels = parseXml(relsXml);
    const layoutTarget = Array.from(rels.getElementsByTagName('Relationship'))
      .find((relationship) => relationship.getAttribute('Type')?.endsWith('/slideLayout'))
      ?.getAttribute('Target');
    if (!layoutTarget) continue;
    const layoutXml = await zip.file(resolveTarget(slidePath, layoutTarget))?.async('text');
    if (!layoutXml) continue;
    const slide = parseXml(slideXml);
    const layout = parseXml(layoutXml);
    const layoutShapes = elementsByLocalName(layout, 'sp');
    let slideChanged = false;
    for (const shape of elementsByLocalName(slide, 'sp')) {
      const properties = directChild(shape, 'spPr');
      if (!properties || directChild(properties, 'xfrm')) continue;
      const placeholder = firstByLocalName(shape, 'ph');
      if (!placeholder) continue;
      const index = placeholder.getAttribute('idx');
      const type = placeholder.getAttribute('type') || 'body';
      const inherited = layoutShapes.find((layoutShape) => {
        const candidate = firstByLocalName(layoutShape, 'ph');
        if (!candidate) return false;
        if (index) return candidate.getAttribute('idx') === index;
        const candidateType = candidate.getAttribute('type') || 'body';
        return (
          candidateType === type ||
          (['ctrTitle', 'title'].includes(candidateType) && ['ctrTitle', 'title'].includes(type))
        );
      });
      const inheritedProperties = inherited && directChild(inherited, 'spPr');
      const transform = inheritedProperties && directChild(inheritedProperties, 'xfrm');
      if (!transform) continue;
      properties.insertBefore(slide.importNode(transform, true), properties.firstChild);
      changed = true;
      slideChanged = true;
    }
    if (slideChanged) zip.file(slidePath, serializeXml(slide));
  }
  return changed;
};

const findNode = (document: XMLDocument, nodeId: string) => {
  const marker = elementsByLocalName(document, 'cNvPr').find(
    (element) => element.getAttribute('id') === nodeId,
  );
  if (!marker) throw new Error(`Slide element ${nodeId} no longer exists`);
  let current: Element | null = marker;
  while (
    current?.parentElement &&
    !['sp', 'pic', 'graphicFrame', 'cxnSp', 'grpSp'].includes(localNameOf(current) || '')
  ) {
    current = current.parentElement;
  }
  if (!current) throw new Error(`Slide element ${nodeId} is malformed`);
  return current;
};

const ensureTransform = (document: XMLDocument, node: Element) => {
  const propertyName = localNameOf(node) === 'graphicFrame' ? 'xfrm' : 'spPr';
  let properties = directChild(node, propertyName);
  if (!properties) {
    properties = document.createElementNS(namespaces.p, `p:${propertyName}`);
    node.appendChild(properties);
  }
  let transform = localNameOf(properties) === 'xfrm' ? properties : directChild(properties, 'xfrm');
  if (!transform) {
    transform = document.createElementNS(namespaces.a, 'a:xfrm');
    properties.insertBefore(transform, properties.firstChild);
  }
  let offset = directChild(transform, 'off');
  let extent = directChild(transform, 'ext');
  if (!offset) {
    offset = document.createElementNS(namespaces.a, 'a:off');
    transform.appendChild(offset);
  }
  if (!extent) {
    extent = document.createElementNS(namespaces.a, 'a:ext');
    transform.appendChild(extent);
  }
  return { extent, offset };
};

const setFrame = (document: XMLDocument, node: Element, frame: PptxElementFrame) => {
  const { extent, offset } = ensureTransform(document, node);
  offset.setAttribute('x', String(Math.round(frame.x)));
  offset.setAttribute('y', String(Math.round(frame.y)));
  extent.setAttribute('cx', String(Math.max(1, Math.round(frame.w))));
  extent.setAttribute('cy', String(Math.max(1, Math.round(frame.h))));
};

const nextNodeId = (document: XMLDocument) =>
  String(
    Math.max(
      0,
      ...elementsByLocalName(document, 'cNvPr').map((node) => Number(node.getAttribute('id')) || 0),
    ) + 1,
  );

const appendToShapeTree = (document: XMLDocument, element: Element) => {
  const shapeTree = firstByLocalName(document, 'spTree');
  if (!shapeTree) throw new Error('Slide shape tree is missing');
  const extensionList = directChild(shapeTree, 'extLst');
  shapeTree.insertBefore(element, extensionList || null);
};

const frameXml = (frame: PptxElementFrame) =>
  `<a:xfrm><a:off x="${Math.round(frame.x)}" y="${Math.round(frame.y)}"/><a:ext cx="${Math.round(frame.w)}" cy="${Math.round(frame.h)}"/></a:xfrm>`;

const parseFragment = (document: XMLDocument, xml: string) => {
  const wrapper = parseXml(
    `<root xmlns:a="${namespaces.a}" xmlns:c="${namespaces.c}" xmlns:p="${namespaces.p}" xmlns:r="${namespaces.r}">${xml}</root>`,
  );
  const element = wrapper.documentElement.firstElementChild;
  if (!element) throw new Error('Unable to create PPTX element');
  return document.importNode(element, true);
};

const escapeXml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const shapeXml = ({
  fill,
  frame,
  id,
  name,
  preset,
  text,
}: {
  fill: string;
  frame: PptxElementFrame;
  id: string;
  name: string;
  preset: string;
  text?: string;
}) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeXml(name)}"/><p:cNvSpPr txBox="${text === undefined ? '0' : '1'}"/><p:nvPr/></p:nvSpPr><p:spPr>${frameXml(frame)}<a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${normalizeHex(fill)}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>${
    text === undefined
      ? ''
      : `<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="2400"/><a:t>${escapeXml(text)}</a:t></a:r><a:endParaRPr lang="en-US" sz="2400"/></a:p></p:txBody>`
  }</p:sp>`;

const ensureContentType = (
  contentTypes: XMLDocument,
  kind: 'Default' | 'Override',
  key: 'Extension' | 'PartName',
  value: string,
  contentType: string,
) => {
  const existing = Array.from(contentTypes.getElementsByTagName(kind)).find(
    (element) => element.getAttribute(key) === value,
  );
  if (existing) return;
  const element = contentTypes.createElementNS(contentTypes.documentElement.namespaceURI, kind);
  element.setAttribute(key, value);
  element.setAttribute('ContentType', contentType);
  contentTypes.documentElement.appendChild(element);
};

const chartXml = ({ categories, values }: PptxChartData) => {
  const categoryPoints = categories
    .map((category, index) => `<c:pt idx="${index}"><c:v>${escapeXml(category)}</c:v></c:pt>`)
    .join('');
  const valuePoints = values
    .map(
      (value, index) =>
        `<c:pt idx="${index}"><c:v>${Number.isFinite(value) ? value : 0}</c:v></c:pt>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="${namespaces.c}" xmlns:a="${namespaces.a}" xmlns:r="${namespaces.r}"><c:date1904 val="0"/><c:lang val="en-US"/><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Series 1</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="1677FF"/></a:solidFill></c:spPr><c:cat><c:strLit><c:ptCount val="${categories.length}"/>${categoryPoints}</c:strLit></c:cat><c:val><c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${valuePoints}</c:numLit></c:val></c:ser><c:axId val="1723849264"/><c:axId val="1723850688"/></c:barChart><c:catAx><c:axId val="1723849264"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="1723850688"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="1723850688"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="1723849264"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx></c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/></c:printSettings></c:chartSpace>`;
};

const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (type: string, data: Uint8Array) => {
  const output = new Uint8Array(data.length + 12);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.length);
  output.set(new TextEncoder().encode(type), 4);
  output.set(data, 8);
  view.setUint32(data.length + 8, crc32(output.subarray(4, data.length + 8)));
  return output;
};

const chartFallbackPng = async ({ values }: PptxChartData) => {
  const width = 840;
  const height = 360;
  const pixels = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    for (let x = 0; x < width; x += 1) pixels.set([255, 255, 255, 255], row + 1 + x * 4);
  }
  const paint = (x: number, y: number, w: number, h: number, color: number[]) => {
    for (let py = Math.max(0, Math.round(y)); py < Math.min(height, Math.round(y + h)); py += 1) {
      const row = py * (width * 4 + 1);
      for (let px = Math.max(0, Math.round(x)); px < Math.min(width, Math.round(x + w)); px += 1) {
        pixels.set(color, row + 1 + px * 4);
      }
    }
  };
  paint(60, 280, 740, 2, [191, 191, 191, 255]);
  const maximum = Math.max(1, ...values.map((value) => (Number.isFinite(value) ? value : 0)));
  const slotWidth = 720 / Math.max(1, values.length);
  values.forEach((value, index) => {
    const barHeight = (Math.max(0, Number.isFinite(value) ? value : 0) / maximum) * 240;
    paint(
      60 + index * slotWidth + slotWidth * 0.2,
      280 - barHeight,
      slotWidth * 0.6,
      barHeight,
      [22, 119, 255, 255],
    );
  });
  const compressed = new Uint8Array(
    await new Response(
      new Blob([pixels]).stream().pipeThrough(new CompressionStream('deflate')),
    ).arrayBuffer(),
  );
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const chunks = [
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', new Uint8Array()),
  ];
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  chunks.forEach((chunk) => {
    output.set(chunk, offset);
    offset += chunk.length;
  });
  return output;
};

const chartFallbackNode = (document: XMLDocument, chartNode: Element) => {
  const chartId = firstByLocalName(chartNode, 'cNvPr')?.getAttribute('id');
  if (!chartId) return;
  let fallback: Element | null | undefined = elementsByLocalName(document, 'cNvPr').find(
    (element) => element.getAttribute('name') === `Chart Fallback ${chartId}`,
  );
  while (fallback?.parentElement && localNameOf(fallback) !== 'pic') {
    fallback = fallback.parentElement;
  }
  return fallback && localNameOf(fallback) === 'pic' ? fallback : undefined;
};

const replaceChartData = (document: XMLDocument, chart: PptxChartData) => {
  const categoryCache =
    firstByLocalName(document, 'strLit') || firstByLocalName(document, 'strCache');
  const valueCache = firstByLocalName(document, 'numLit') || firstByLocalName(document, 'numCache');
  if (!categoryCache || !valueCache) throw new Error('This chart has no editable cached series');
  for (const cache of [categoryCache, valueCache]) {
    for (const child of Array.from(cache.children)) {
      if (localNameOf(child) === 'pt' || localNameOf(child) === 'ptCount') child.remove();
    }
  }
  const count = document.createElementNS(namespaces.c, 'c:ptCount');
  count.setAttribute('val', String(chart.categories.length));
  categoryCache.appendChild(count);
  chart.categories.forEach((category, index) => {
    const point = parseFragment(
      document,
      `<c:pt idx="${index}"><c:v>${escapeXml(category)}</c:v></c:pt>`,
    );
    categoryCache.appendChild(point);
  });
  const valueCount = document.createElementNS(namespaces.c, 'c:ptCount');
  valueCount.setAttribute('val', String(chart.values.length));
  valueCache.appendChild(valueCount);
  chart.values.forEach((value, index) => {
    valueCache.appendChild(
      parseFragment(
        document,
        `<c:pt idx="${index}"><c:v>${Number.isFinite(value) ? value : 0}</c:v></c:pt>`,
      ),
    );
  });
};

const mutateSlide = async (
  zip: JSZip,
  slideIndex: number,
  mutate: (document: XMLDocument, path: string) => Promise<void> | void,
) => {
  const { document, path } = await getSlide(zip, slideIndex);
  await mutate(document, path);
  zip.file(path, serializeXml(document));
};

const applyImage = async (zip: JSZip, operation: AddImageOperation) => {
  await mutateSlide(zip, operation.slideIndex, async (document, slidePath) => {
    const relsPath = relsPathFor(slidePath);
    const rels = parseXml(
      (await zip.file(relsPath)?.async('text')) || serializeXml(relationshipDocument()),
    );
    const extension = (
      operation.fileName.split('.').pop() ||
      operation.mimeType.split('/').pop() ||
      'png'
    )
      .toLowerCase()
      .replace('jpeg', 'jpg');
    const mediaNumbers = Object.keys(zip.files)
      .map((path) => path.match(/^ppt\/media\/image(\d+)\./u)?.[1])
      .filter(Boolean)
      .map(Number);
    const mediaPath = `ppt/media/image${Math.max(0, ...mediaNumbers) + 1}.${extension}`;
    zip.file(mediaPath, operation.bytes);
    const relationshipId = appendRelationship(
      rels,
      relativeTarget(slidePath, mediaPath),
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
    );
    const id = nextNodeId(document);
    appendToShapeTree(
      document,
      parseFragment(
        document,
        `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${frameXml(operation.frame)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`,
      ),
    );
    zip.file(relsPath, serializeXml(rels));
    const contentTypes = parseXml((await zip.file('[Content_Types].xml')?.async('text')) || '');
    ensureContentType(contentTypes, 'Default', 'Extension', extension, operation.mimeType);
    zip.file('[Content_Types].xml', serializeXml(contentTypes));
  });
};

const applyOperation = async (zip: JSZip, operation: PptxEditOperation) => {
  if (operation.type === 'moveSlide') {
    const { presentation, slideIds } = await presentationSlidePaths(zip);
    const [moved] = slideIds.splice(operation.fromIndex, 1);
    if (!moved) throw new Error('The slide to move no longer exists');
    slideIds.splice(operation.toIndex, 0, moved);
    const list = firstByLocalName(presentation, 'sldIdLst');
    if (!list) throw new Error('Slide order metadata is missing');
    slideIds.forEach((slide) => list.appendChild(slide));
    zip.file('ppt/presentation.xml', serializeXml(presentation));
    return;
  }

  if (operation.type === 'duplicateSlide') {
    const { paths, presentation, rels, slideIds } = await presentationSlidePaths(zip);
    const sourcePath = paths[operation.slideIndex];
    const source = await zip.file(sourcePath)?.async('uint8array');
    if (!source) throw new Error('The slide to duplicate no longer exists');
    const numbers = paths.map((path) => Number(path.match(/slide(\d+)\.xml$/u)?.[1]) || 0);
    const targetPath = `ppt/slides/slide${Math.max(...numbers) + 1}.xml`;
    zip.file(targetPath, source);
    const sourceRelsPath = relsPathFor(sourcePath);
    const sourceRels = await zip.file(sourceRelsPath)?.async('uint8array');
    if (sourceRels) zip.file(relsPathFor(targetPath), sourceRels);
    const relationshipId = appendRelationship(
      rels,
      relativeTarget('ppt/presentation.xml', targetPath),
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
    );
    const clonedId = slideIds[operation.slideIndex].cloneNode(true) as Element;
    clonedId.setAttribute(
      'id',
      String(Math.max(...slideIds.map((slide) => Number(slide.getAttribute('id')) || 255)) + 1),
    );
    clonedId.setAttributeNS(namespaces.r, 'r:id', relationshipId);
    const list = firstByLocalName(presentation, 'sldIdLst');
    list?.insertBefore(clonedId, slideIds[operation.slideIndex].nextSibling);
    zip.file('ppt/presentation.xml', serializeXml(presentation));
    zip.file('ppt/_rels/presentation.xml.rels', serializeXml(rels));
    const contentTypes = parseXml((await zip.file('[Content_Types].xml')?.async('text')) || '');
    ensureContentType(
      contentTypes,
      'Override',
      'PartName',
      `/${targetPath}`,
      'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
    );
    zip.file('[Content_Types].xml', serializeXml(contentTypes));
    return;
  }

  if (operation.type === 'deleteSlide') {
    const { paths, presentation, rels, slideIds } = await presentationSlidePaths(zip);
    if (paths.length <= 1) throw new Error('A presentation must contain at least one slide');
    const slideId = slideIds[operation.slideIndex];
    const relationshipId = relationshipIdOf(slideId);
    slideId.remove();
    Array.from(rels.getElementsByTagName('Relationship'))
      .find((relationship) => relationship.getAttribute('Id') === relationshipId)
      ?.remove();
    const path = paths[operation.slideIndex];
    zip.remove(path);
    zip.remove(relsPathFor(path));
    zip.file('ppt/presentation.xml', serializeXml(presentation));
    zip.file('ppt/_rels/presentation.xml.rels', serializeXml(rels));
    const contentTypes = parseXml((await zip.file('[Content_Types].xml')?.async('text')) || '');
    Array.from(contentTypes.getElementsByTagName('Override'))
      .find((entry) => entry.getAttribute('PartName') === `/${path}`)
      ?.remove();
    zip.file('[Content_Types].xml', serializeXml(contentTypes));
    return;
  }

  await mutateSlide(zip, operation.slideIndex, async (document, slidePath) => {
    if (operation.type === 'setFrame') {
      const node = findNode(document, operation.nodeId);
      setFrame(document, node, operation.frame);
      const fallback = chartFallbackNode(document, node);
      if (fallback) setFrame(document, fallback, operation.frame);
      return;
    }
    if (operation.type === 'deleteElement') {
      const node = findNode(document, operation.nodeId);
      chartFallbackNode(document, node)?.remove();
      node.remove();
      return;
    }
    if (operation.type === 'setText') {
      const node = findNode(document, operation.nodeId);
      const textNodes = elementsByLocalName(node, 't');
      if (textNodes.length === 0) throw new Error('The selected element has no editable text');
      textNodes[0].textContent = operation.text;
      textNodes.slice(1).forEach((textNode) => {
        textNode.textContent = '';
      });
      return;
    }
    if (operation.type === 'formatText') {
      const node = findNode(document, operation.nodeId);
      const runs = elementsByLocalName(node, 'rPr');
      if (runs.length === 0) throw new Error('The selected element has no editable text');
      for (const run of runs) {
        if (operation.fontSize)
          run.setAttribute('sz', String(Math.round(operation.fontSize * 100)));
        if (operation.bold !== undefined) run.setAttribute('b', operation.bold ? '1' : '0');
        if (operation.color) {
          Array.from(run.children)
            .filter((child) => localNameOf(child)?.endsWith('Fill'))
            .forEach((fill) => fill.remove());
          run.appendChild(
            parseFragment(
              document,
              `<a:solidFill><a:srgbClr val="${normalizeHex(operation.color)}"/></a:solidFill>`,
            ),
          );
        }
      }
      if (operation.align) {
        elementsByLocalName(node, 'p').forEach((paragraph) => {
          let properties = directChild(paragraph, 'pPr');
          if (!properties) {
            properties = document.createElementNS(namespaces.a, 'a:pPr');
            paragraph.insertBefore(properties, paragraph.firstChild);
          }
          properties.setAttribute('algn', operation.align!);
        });
      }
      return;
    }
    if (operation.type === 'addText' || operation.type === 'addShape') {
      const id = nextNodeId(document);
      const isText = operation.type === 'addText';
      appendToShapeTree(
        document,
        parseFragment(
          document,
          shapeXml({
            fill: isText ? 'FFFFFF' : operation.fill,
            frame: operation.frame,
            id,
            name: isText ? `TextBox ${id}` : `Shape ${id}`,
            preset: isText ? 'rect' : operation.shape,
            text: isText ? operation.text : undefined,
          }),
        ),
      );
      return;
    }
    if (operation.type === 'setSlideLayout') {
      const relsPath = relsPathFor(slidePath);
      const rels = parseXml(
        (await zip.file(relsPath)?.async('text')) || serializeXml(relationshipDocument()),
      );
      const layoutRelationship = Array.from(rels.getElementsByTagName('Relationship')).find(
        (relationship) => relationship.getAttribute('Type')?.endsWith('/slideLayout'),
      );
      if (!layoutRelationship) throw new Error('Slide layout relationship is missing');
      layoutRelationship.setAttribute('Target', relativeTarget(slidePath, operation.layoutPath));
      zip.file(relsPath, serializeXml(rels));
      return;
    }
    if (operation.type === 'addChart') {
      const relsPath = relsPathFor(slidePath);
      const rels = parseXml(
        (await zip.file(relsPath)?.async('text')) || serializeXml(relationshipDocument()),
      );
      const chartNumbers = Object.keys(zip.files)
        .map((path) => path.match(/^ppt\/charts\/chart(\d+)\.xml$/u)?.[1])
        .filter(Boolean)
        .map(Number);
      const chartPath = `ppt/charts/chart${Math.max(0, ...chartNumbers) + 1}.xml`;
      const relationshipId = appendRelationship(
        rels,
        relativeTarget(slidePath, chartPath),
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart',
      );
      const id = nextNodeId(document);
      const fallbackId = String(Number(id) + 1);
      const mediaNumbers = Object.keys(zip.files)
        .map((path) => path.match(/^ppt\/media\/chartFallback(\d+)\.png$/u)?.[1])
        .filter(Boolean)
        .map(Number);
      const fallbackPath = `ppt/media/chartFallback${Math.max(0, ...mediaNumbers) + 1}.png`;
      const fallbackRelationshipId = appendRelationship(
        rels,
        relativeTarget(slidePath, fallbackPath),
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
      );
      appendToShapeTree(
        document,
        parseFragment(
          document,
          `<p:pic><p:nvPicPr><p:cNvPr id="${fallbackId}" name="Chart Fallback ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${fallbackRelationshipId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${frameXml(operation.frame)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`,
        ),
      );
      appendToShapeTree(
        document,
        parseFragment(
          document,
          `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Chart ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${Math.round(operation.frame.x)}" y="${Math.round(operation.frame.y)}"/><a:ext cx="${Math.round(operation.frame.w)}" cy="${Math.round(operation.frame.h)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="${relationshipId}"/></a:graphicData></a:graphic></p:graphicFrame>`,
        ),
      );
      zip.file(chartPath, chartXml(operation.chart));
      zip.file(fallbackPath, await chartFallbackPng(operation.chart));
      zip.file(relsPath, serializeXml(rels));
      const contentTypes = parseXml((await zip.file('[Content_Types].xml')?.async('text')) || '');
      ensureContentType(contentTypes, 'Default', 'Extension', 'png', 'image/png');
      ensureContentType(
        contentTypes,
        'Override',
        'PartName',
        `/${chartPath}`,
        'application/vnd.openxmlformats-officedocument.drawingml.chart+xml',
      );
      zip.file('[Content_Types].xml', serializeXml(contentTypes));
      return;
    }
    if (operation.type === 'setChartData') {
      const node = findNode(document, operation.nodeId);
      const chartReference = firstByLocalName(node, 'chart');
      const relationshipId = chartReference ? relationshipIdOf(chartReference) : null;
      const relsPath = relsPathFor(slidePath);
      const rels = parseXml((await zip.file(relsPath)?.async('text')) || '');
      const relationship = Array.from(rels.getElementsByTagName('Relationship')).find(
        (entry) => entry.getAttribute('Id') === relationshipId,
      );
      const target = relationship?.getAttribute('Target');
      if (!target) throw new Error('The selected chart data is missing');
      const path = resolveTarget(slidePath, target);
      const xml = await zip.file(path)?.async('text');
      if (!xml) throw new Error('The selected chart part is missing');
      const chartDocument = parseXml(xml);
      replaceChartData(chartDocument, operation.chart);
      zip.file(path, serializeXml(chartDocument));
      const fallback = chartFallbackNode(document, node);
      const fallbackReference = fallback ? firstByLocalName(fallback, 'blip') : undefined;
      const fallbackRelationshipId = fallbackReference
        ? fallbackReference.getAttributeNS(namespaces.r, 'embed') ||
          fallbackReference.getAttribute('r:embed') ||
          Array.from(fallbackReference.attributes).find(
            (attribute) => localNameOf(attribute) === 'embed',
          )?.value
        : undefined;
      const fallbackTarget = Array.from(rels.getElementsByTagName('Relationship'))
        .find((entry) => entry.getAttribute('Id') === fallbackRelationshipId)
        ?.getAttribute('Target');
      if (fallbackTarget) {
        zip.file(resolveTarget(slidePath, fallbackTarget), await chartFallbackPng(operation.chart));
      }
    }
  });
};

export const editPptx = async (
  source: ArrayBuffer,
  operation: PptxEditOperation | AddImageOperation,
): Promise<ArrayBuffer> => {
  const zip = await JSZip.loadAsync(source);
  await materializePlaceholderTransforms(zip);
  if (operation.type === 'addImage') await applyImage(zip, operation);
  else await applyOperation(zip, operation);
  const output = await zip.generateAsync({
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    type: 'arraybuffer',
  });
  return output;
};

export const preparePptxForEditing = async (source: ArrayBuffer) => {
  const zip = await JSZip.loadAsync(source);
  const changed = await materializePlaceholderTransforms(zip);
  if (!changed) return source;
  return zip.generateAsync({
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    type: 'arraybuffer',
  });
};

export const inspectPptxPackage = async (source: ArrayBuffer) => {
  const zip = await JSZip.loadAsync(source);
  const { paths } = await presentationSlidePaths(zip);
  return {
    entryCount: Object.keys(zip.files).filter((path) => !zip.files[path].dir).length,
    slideCount: paths.length,
    slidePaths: paths,
  };
};
