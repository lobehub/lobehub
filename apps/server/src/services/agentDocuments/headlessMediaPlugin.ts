import {
  DecoratorNode,
  type LexicalEditor,
  type LexicalNode,
  type LexicalNodeConfig,
  type NodeKey,
} from 'lexical';

const IMAGE_NODE_TYPE = 'image';
const BLOCK_IMAGE_NODE_TYPE = 'block-image';

interface ServiceId<T> {
  readonly __serviceId: string;
  __serviceType?: T;
}

interface EditorKernel {
  registerNodes: (nodes: LexicalNodeConfig[]) => void;
  requireService: <T>(serviceId: ServiceId<T>) => T | null;
}

interface EditorPlugin {
  destroy: () => void;
  onInit?: (editor: LexicalEditor) => void;
}

interface LiteXMLWriterContext {
  createXmlNode: (tagName: string, attributes?: Record<string, string | undefined>) => unknown;
}

interface LiteXMLService {
  registerXMLReader: (
    tagName: string,
    reader: (xmlNode: Element, children: SerializedNodeRecord[]) => SerializedNodeRecord | false,
  ) => void;
  registerXMLWriter: (
    nodeType: string,
    writer: (node: LexicalNode, ctx: LiteXMLWriterContext) => unknown | false,
  ) => void;
}

interface MarkdownWriterContext {
  appendLine: (value: string) => void;
}

interface MarkdownImageNode {
  alt?: string | null;
  url?: string | null;
}

interface MarkdownService {
  registerMarkdownReader: (
    type: string,
    reader: (node: MarkdownImageNode) => SerializedNodeRecord,
  ) => void;
  registerMarkdownWriter: (
    type: string,
    writer: (ctx: MarkdownWriterContext, node: LexicalNode) => void,
  ) => void;
}

interface INodeService {
  registerProcessNodeTree: (process: (tree: { root: SerializedNodeRecord }) => void) => void;
}

interface SerializedNodeRecord {
  [key: string]: unknown;
  children?: SerializedNodeRecord[];
  type?: string;
}

interface SerializedImageNode extends SerializedNodeRecord {
  altText: string;
  height: number;
  maxWidth?: number;
  src: string;
  type: typeof IMAGE_NODE_TYPE | typeof BLOCK_IMAGE_NODE_TYPE;
  version: 1;
  width: number;
}

const ILitexmlService: ServiceId<LiteXMLService> = { __serviceId: 'ILitexmlService' };
const IMarkdownShortCutService: ServiceId<MarkdownService> = {
  __serviceId: 'MarkdownShortCutService',
};
const INodeService: ServiceId<INodeService> = { __serviceId: 'INodeService' };

const parseDimension = (value: string | null) => {
  if (!value) return undefined;

  const numberValue = Number.parseInt(value, 10);
  return Number.isFinite(numberValue) ? numberValue : undefined;
};

const normalizeDimension = (value?: number | string | null): number | 'inherit' => {
  if (typeof value === 'number' && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  return 'inherit';
};

const serializeDimension = (value: number | 'inherit') => (value === 'inherit' ? 0 : value);

const createSerializedImageNode = ({
  altText = '',
  block = true,
  maxWidth,
  src = '',
  width,
}: {
  altText?: string;
  block?: boolean;
  maxWidth?: number;
  src?: string;
  width?: number;
}): SerializedImageNode => ({
  altText,
  height: 0,
  maxWidth,
  src,
  type: block ? BLOCK_IMAGE_NODE_TYPE : IMAGE_NODE_TYPE,
  version: 1,
  width: width ?? 0,
});

class BaseAgentDocumentImageNode extends DecoratorNode<null> {
  protected __altText: string;
  protected __height: number | 'inherit';
  protected __maxWidth?: number;
  protected __src: string;
  protected __width: number | 'inherit';

  constructor(
    src: string,
    altText: string,
    maxWidth?: number,
    width?: number | string | null,
    height?: number | string | null,
    key?: NodeKey,
  ) {
    super(key);
    this.__src = src;
    this.__altText = altText;
    this.__maxWidth = maxWidth;
    this.__width = normalizeDimension(width);
    this.__height = normalizeDimension(height);
  }

  createDOM(): HTMLElement {
    if (typeof document === 'undefined') return {} as HTMLElement;

    return document.createElement(this.isInline() ? 'span' : 'div');
  }

  decorate(): null {
    return null;
  }

  exportJSON(): SerializedImageNode {
    return {
      ...super.exportJSON(),
      altText: this.__altText,
      height: serializeDimension(this.__height),
      maxWidth: this.__maxWidth,
      src: this.__src,
      width: serializeDimension(this.__width),
    } as SerializedImageNode;
  }

  getAltText() {
    return this.__altText;
  }

  getMaxWidth() {
    return this.__maxWidth;
  }

  getSrc() {
    return this.__src;
  }

  getWidth() {
    return this.__width;
  }

  isInline() {
    return true;
  }

  updateDOM(): false {
    return false;
  }
}

class AgentDocumentImageNode extends BaseAgentDocumentImageNode {
  static clone(node: AgentDocumentImageNode): AgentDocumentImageNode {
    return new AgentDocumentImageNode(
      node.__src,
      node.__altText,
      node.__maxWidth,
      node.__width,
      node.__height,
      node.__key,
    );
  }

  static getType() {
    return IMAGE_NODE_TYPE;
  }

  static importJSON(serializedNode: SerializedImageNode): AgentDocumentImageNode {
    return new AgentDocumentImageNode(
      serializedNode.src,
      serializedNode.altText,
      serializedNode.maxWidth,
      serializedNode.width,
      serializedNode.height,
    );
  }
}

class AgentDocumentBlockImageNode extends BaseAgentDocumentImageNode {
  static clone(node: AgentDocumentBlockImageNode): AgentDocumentBlockImageNode {
    return new AgentDocumentBlockImageNode(
      node.__src,
      node.__altText,
      node.__maxWidth,
      node.__width,
      node.__height,
      node.__key,
    );
  }

  static getType() {
    return BLOCK_IMAGE_NODE_TYPE;
  }

  static importJSON(serializedNode: SerializedImageNode): AgentDocumentBlockImageNode {
    return new AgentDocumentBlockImageNode(
      serializedNode.src,
      serializedNode.altText,
      serializedNode.maxWidth,
      serializedNode.width,
      serializedNode.height,
    );
  }

  isInline() {
    return false;
  }
}

const isImageNode = (node: LexicalNode): node is BaseAgentDocumentImageNode =>
  node.getType() === IMAGE_NODE_TYPE || node.getType() === BLOCK_IMAGE_NODE_TYPE;

const normalizeBlockImageParagraph = (node: SerializedNodeRecord): SerializedNodeRecord => {
  if (Array.isArray(node.children)) {
    const children = node.children.map(normalizeBlockImageParagraph);

    if (
      node.type === 'paragraph' &&
      children.length === 1 &&
      children[0].type === BLOCK_IMAGE_NODE_TYPE
    ) {
      return children[0];
    }

    return { ...node, children };
  }

  return node;
};

export class AgentDocumentMediaPlugin implements EditorPlugin {
  static readonly pluginName = 'AgentDocumentMediaPlugin';

  constructor(private readonly kernel: EditorKernel) {
    kernel.registerNodes([AgentDocumentImageNode, AgentDocumentBlockImageNode]);
  }

  destroy() {}

  onInit(_editor: LexicalEditor) {
    this.registerLiteXML();
    this.registerMarkdown();
    this.registerINode();
  }

  private registerINode() {
    const service = this.kernel.requireService(INodeService);
    if (!service) return;

    service.registerProcessNodeTree(({ root }) => {
      if (!Array.isArray(root.children)) return;

      root.children = root.children.map(normalizeBlockImageParagraph);
    });
  }

  private registerLiteXML() {
    const service = this.kernel.requireService(ILitexmlService);
    if (!service) return;

    service.registerXMLReader('img', (xmlNode) => {
      const explicitInline = xmlNode.getAttribute('block') === 'false';

      return createSerializedImageNode({
        altText: xmlNode.getAttribute('alt') || '',
        block: !explicitInline,
        maxWidth: parseDimension(xmlNode.getAttribute('max-width')),
        src: xmlNode.getAttribute('src') || '',
        width: parseDimension(xmlNode.getAttribute('width')),
      });
    });

    const writeImage = (node: LexicalNode, ctx: LiteXMLWriterContext) => {
      if (!isImageNode(node)) return false;

      const attributes: Record<string, string | undefined> = {
        src: node.getSrc(),
      };
      if (node.getAltText()) attributes.alt = node.getAltText();
      if (node.getType() === BLOCK_IMAGE_NODE_TYPE) attributes.block = 'true';
      if (typeof node.getMaxWidth() === 'number')
        attributes['max-width'] = String(node.getMaxWidth());
      if (typeof node.getWidth() === 'number') attributes.width = String(node.getWidth());

      return ctx.createXmlNode('img', attributes);
    };

    service.registerXMLWriter(IMAGE_NODE_TYPE, writeImage);
    service.registerXMLWriter(BLOCK_IMAGE_NODE_TYPE, writeImage);
  }

  private registerMarkdown() {
    const service = this.kernel.requireService(IMarkdownShortCutService);
    if (!service) return;

    const writeImage = (ctx: MarkdownWriterContext, node: LexicalNode) => {
      if (!isImageNode(node)) return;

      const markdown = `![${node.getAltText()}](${node.getSrc()})`;
      ctx.appendLine(node.getType() === BLOCK_IMAGE_NODE_TYPE ? `${markdown}\n\n` : markdown);
    };

    service.registerMarkdownWriter(IMAGE_NODE_TYPE, writeImage);
    service.registerMarkdownWriter(BLOCK_IMAGE_NODE_TYPE, writeImage);
    service.registerMarkdownReader('image', (node) =>
      createSerializedImageNode({
        altText: node.alt || '',
        block: true,
        src: node.url || '',
      }),
    );
  }
}
