import createDOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  '#text',
  'article',
  'aside',
  'b',
  'blockquote',
  'br',
  'button',
  'caption',
  'code',
  'col',
  'colgroup',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'em',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'i',
  'input',
  'label',
  'legend',
  'li',
  'main',
  'mark',
  'nav',
  'ol',
  'optgroup',
  'option',
  'output',
  'p',
  'pre',
  'progress',
  'section',
  'select',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'textarea',
  'th',
  'thead',
  'time',
  'tr',
  'ul',
];

const ALLOWED_ATTRIBUTES = [
  'checked',
  'class',
  'colspan',
  'disabled',
  'for',
  'height',
  'hidden',
  'id',
  'label',
  'max',
  'maxlength',
  'min',
  'multiple',
  'name',
  'open',
  'placeholder',
  'readonly',
  'role',
  'rows',
  'rowspan',
  'selected',
  'step',
  'style',
  'tabindex',
  'title',
  'type',
  'value',
  'width',
];

const ALLOWED_INPUT_TYPES = new Set(['button', 'checkbox', 'number', 'radio', 'range', 'text']);

/** Browser-only, no global DOMPurify hooks/configuration and no live DOM writes. */
export const sanitizeSandboxHtml = (html: string): string => {
  if (typeof window === 'undefined') throw new Error('Sandbox rendering requires a browser DOM');

  const purifier = createDOMPurify(window);
  if (!purifier.isSupported) throw new Error('A supported HTML sanitizer is required');

  // A template's contents are inert even during parsing: resource-bearing
  // markup must not get a chance to fetch before the sanitizer removes it.
  const template = document.createElement('template');
  template.innerHTML = html;
  const fragment = purifier.sanitize(template.content, {
    ALLOWED_ATTR: ALLOWED_ATTRIBUTES,
    ALLOWED_TAGS,
    ALLOW_ARIA_ATTR: true,
    ALLOW_DATA_ATTR: true,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    KEEP_CONTENT: false,
    RETURN_DOM_FRAGMENT: true,
  });

  for (const element of fragment.querySelectorAll('*')) {
    // Do not allow namespace switches or DOM features with navigation/network
    // effects. This also checks DOMPurify's result before the srcdoc reparse.
    if (
      element.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
      !ALLOWED_TAGS.includes(element.localName)
    ) {
      element.remove();
      continue;
    }
    for (const attribute of element.getAttributeNames()) {
      if (
        !ALLOWED_ATTRIBUTES.includes(attribute) &&
        !attribute.startsWith('aria-') &&
        !attribute.startsWith('data-')
      )
        element.removeAttribute(attribute);
    }
    for (const attribute of ['id', 'name']) {
      if (element.getAttribute(attribute)?.startsWith('__lobe_ui_'))
        element.removeAttribute(attribute);
    }
    if (element.localName === 'input') {
      if (!ALLOWED_INPUT_TYPES.has((element.getAttribute('type') || 'text').toLowerCase())) {
        element.remove();
        continue;
      }
      element.setAttribute('autocomplete', 'off');
    }
    if (element.localName === 'button') element.setAttribute('type', 'button');
  }

  const container = document.createElement('div');
  container.append(fragment);
  return container.innerHTML;
};
