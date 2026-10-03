import { Readability } from '@mozilla/readability';
import { Window } from 'happy-dom';
import type { TranslatorConfigFactory, TranslatorConfigObject } from 'node-html-markdown';
import { NodeHtmlMarkdown } from 'node-html-markdown';

import type { FilterOptions } from '../type';

/** Truncate HTML to 1 MB before DOM parsing to prevent CPU spikes on large pages */
export const MAX_HTML_SIZE = 1024 * 1024;

/**
 * node-html-markdown converts a table cell with a restricted set of child
 * translators that holds no block element, so every boundary inside the cell
 * disappears without a trace: `Mon-Fri<br>9:00-17:00` becomes
 * `Mon-Fri9:00-17:00`, and two paragraphs become one run-on word. Its cell
 * postprocess also escapes the pipe with `.replace('|', '\\|')`, a string
 * argument, so only the *first* pipe in a cell is escaped and the rest still
 * split the row into columns the header does not have.
 */
const withTableCellFixes = (instance: NodeHtmlMarkdown): NodeHtmlMarkdown => {
  instance.tableCellTranslators.set('br', { content: ' ', recurse: false }, false);
  instance.tableCellTranslators.set('p,div,li', { postfix: ' ' }, false);

  const cellTranslator: TranslatorConfigFactory = ({ visitor }) => ({
    childTranslators: visitor.instance.tableCellTranslators,
    postfix: ' |',
    postprocess: ({ content }) =>
      content
        .replaceAll('|', String.raw`\|`)
        .replaceAll(/\s+/g, ' ')
        .trim(),
    prefix: ' ',
    surroundingNewlines: false,
  });

  instance.tableTranslators.set('th,td', cellTranslator, true);
  instance.tableRowTranslators.set('th,td', cellTranslator, true);

  return instance;
};

const cleanObj = <T extends object>(
  obj: T,
): {
  [K in keyof T as T[K] extends null ? never : K]: T[K];
} => Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== null)) as any;

interface HtmlToMarkdownOutput {
  author?: string;
  content: string;
  description?: string;
  dir?: string;
  lang?: string;
  length?: number;
  publishedTime?: string;
  siteName?: string;
  title?: string;
}

export const htmlToMarkdown = (
  rawHtml: string,
  { url, filterOptions }: { filterOptions: FilterOptions; url: string },
): HtmlToMarkdownOutput => {
  const html = rawHtml.length > MAX_HTML_SIZE ? rawHtml.slice(0, MAX_HTML_SIZE) : rawHtml;
  const window = new Window({
    settings: { disableCSSFileLoading: true, disableJavaScriptEvaluation: true },
    url,
  });

  try {
    const document = window.document;
    document.body.innerHTML = html;

    let parsedContent: ReturnType<Readability<string>['parse']> = null;
    try {
      // @ts-expect-error reason: Readability expects a Document type
      parsedContent = new Readability(document).parse();
    } catch {
      // happy-dom may throw on pages with invalid CSS selectors — fall back to raw HTML
    }

    const useReadability = filterOptions.enableReadability ?? true;

    let htmlNode = html;

    if (useReadability && parsedContent?.content) {
      htmlNode = parsedContent?.content;
    }

    const customTranslators = (
      filterOptions.pureText
        ? {
            a: {
              postprocess: (_: string, content: string) => content,
            },
            img: {
              ignore: true,
            },
          }
        : {}
    ) as TranslatorConfigObject;

    const nodeHtmlMarkdown = withTableCellFixes(new NodeHtmlMarkdown({}, customTranslators));

    const content = nodeHtmlMarkdown.translate(htmlNode);

    const result = {
      author: parsedContent?.byline,
      content,
      description: parsedContent?.excerpt,
      dir: parsedContent?.dir,
      lang: parsedContent?.lang,
      length: parsedContent?.length,
      publishedTime: parsedContent?.publishedTime,
      siteName: parsedContent?.siteName,
      title: parsedContent?.title,
    };

    return cleanObj(result) as HtmlToMarkdownOutput;
  } finally {
    // Release the happy-dom Window so its DOM tree is GC-able immediately, instead
    // of waiting for the function scope to drop. JS evaluation is disabled so the
    // returned promise resolves synchronously in practice — fire and forget.
    void window.happyDOM.close();
  }
};
