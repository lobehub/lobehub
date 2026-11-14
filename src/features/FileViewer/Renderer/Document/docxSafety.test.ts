// @vitest-environment happy-dom
import { renderAsync } from 'docx-preview';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { DOCX_RENDER_OPTIONS, sanitizeRenderedDocx } from './docxSafety';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

const CHUNK_HTML =
  '<html><body><p>chunk</p><script>document.body.dataset.chunk = "1";</script></body></html>';

/**
 * A minimal .docx whose body holds an HTML altChunk carrying a script, a
 * `javascript:` hyperlink, an https hyperlink and a bookmark link.
 *
 * Word writes these attributes prefixed (`r:id`, `w:anchor`). happy-dom's XML
 * parser does not report the bare name as a prefixed attribute's localName,
 * while docx-preview matches attributes by localName only — so the fixture
 * uses bare names, which docx-preview reads the way a browser reads the
 * prefixed form.
 */
const buildDocx = (): Blob => {
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="htm" ContentType="text/html"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="${PKG}">
  <Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="${PKG}">
  <Relationship Id="rIdChunk" Type="${R}/aFChunk" Target="chunk.htm"/>
  <Relationship Id="rIdJs" Type="${R}/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>
  <Relationship Id="rIdWeb" Type="${R}/hyperlink" Target="https://lobehub.com/" TargetMode="External"/>
</Relationships>`,
    'word/chunk.htm': CHUNK_HTML,
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="${W}" xmlns:r="${R}">
  <w:body>
    <w:p><w:r><w:t>Body text</w:t></w:r></w:p>
    <w:altChunk id="rIdChunk"/>
    <w:p><w:hyperlink id="rIdJs"><w:r><w:t>Script link</w:t></w:r></w:hyperlink></w:p>
    <w:p><w:hyperlink id="rIdWeb"><w:r><w:t>Web link</w:t></w:r></w:hyperlink></w:p>
    <w:p><w:hyperlink anchor="_Toc1"><w:r><w:t>Bookmark link</w:t></w:r></w:hyperlink></w:p>
  </w:body>
</w:document>`,
  };

  const zipped = zipSync(
    Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])),
  );
  return new Blob([zipped]);
};

const linkByText = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll('a')].find((anchor) => anchor.textContent === text);

describe('docx preview safety', () => {
  it('default options embed the sample altChunk as an iframe', async () => {
    // Guards the fixture: if this stops producing the iframe, the test below
    // would pass without proving anything.
    const container = document.createElement('div');
    await renderAsync(buildDocx(), container);

    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe!.srcdoc).toContain('<script>');
  });

  it('renders the document without altChunk iframes or script-scheme links', async () => {
    const container = document.createElement('div');
    await renderAsync(buildDocx(), container, undefined, DOCX_RENDER_OPTIONS);
    sanitizeRenderedDocx(container);

    expect(container.querySelector('iframe')).toBeNull();
    expect(container.textContent).toContain('Body text');
    expect(container.textContent).not.toContain('chunk');

    const scriptLink = linkByText(container, 'Script link');
    expect(scriptLink).toBeDefined();
    expect(scriptLink!.hasAttribute('href')).toBe(false);
    expect(linkByText(container, 'Web link')!.getAttribute('href')).toBe('https://lobehub.com/');
    expect(linkByText(container, 'Bookmark link')!.getAttribute('href')).toBe('#_Toc1');
  });

  it('removes active embeds regardless of how they were produced', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<p>text</p><iframe srcdoc="x"></iframe><object></object><embed><a href="vbscript:x">v</a><a href="data:text/html,x">d</a><a href="mailto:a@b.c">m</a>';

    sanitizeRenderedDocx(root);

    expect(root.querySelector('iframe, object, embed')).toBeNull();
    expect(linkByText(root, 'v')!.hasAttribute('href')).toBe(false);
    expect(linkByText(root, 'd')!.hasAttribute('href')).toBe(false);
    expect(linkByText(root, 'm')!.getAttribute('href')).toBe('mailto:a@b.c');
  });
});
