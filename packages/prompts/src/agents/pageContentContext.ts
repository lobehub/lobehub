export interface PageContentMetadata {
  /**
   * Total character count of the markdown content
   */
  charCount?: number;
  /**
   * File type, if applicable
   */
  fileType?: string;
  /**
   * Total line count of the markdown content
   */
  lineCount?: number;
  /**
   * Document title
   */
  title: string;
}

export interface PageContentContext {
  /**
   * Markdown content of the page
   */
  markdown?: string;
  /**
   * Document metadata
   */
  metadata: PageContentMetadata;
  /**
   * XML structure of the page with node IDs
   */
  xml?: string;
}

/**
 * Format markdown content section
 */
const formatMarkdownSection = (markdown: string, metadata: PageContentMetadata): string => {
  const charCount = metadata.charCount ?? markdown.length;
  const lineCount = metadata.lineCount ?? markdown.split('\n').length;

  return `<markdown chars="${charCount}" lines="${lineCount}">
${markdown}
</markdown>`;
};

/**
 * Format XML structure section
 */
const formatXmlSection = (xml: string): string => {
  return `<doc_xml_structure>
<instruction>IMPORTANT: Use node IDs from this XML structure when performing modify or remove operations with modifyNodes.</instruction>
${xml}
</doc_xml_structure>`;
};

/**
 * Format page content into a system prompt context
 */
export const formatPageContentContext = (context: PageContentContext): string => {
  const { xml, markdown, metadata } = context;

  const sections: string[] = [];

  if (markdown) {
    sections.push(formatMarkdownSection(markdown, metadata));
  }

  if (xml) {
    sections.push(formatXmlSection(xml));
  }

  return `<current_page title="${metadata.title}">
${sections.join('\n')}
</current_page>`;
};
