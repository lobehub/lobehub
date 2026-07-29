import type { ContextNode, HelperMaps, IdNode, Message } from '../types';
import { BranchResolver } from './BranchResolver';
import { ContextTreeBuilder } from './ContextTreeBuilder';
import { FlatListBuilder } from './FlatListBuilder';
import { MessageCollector } from './MessageCollector';
import { MessageTransformer } from './MessageTransformer';

/**
 * Phase 3: Transformation
 * Converts structural idTree into semantic contextTree and flatList
 *
 * This is the main coordinator that delegates to specialized builders:
 * - ContextTreeBuilder: Builds the tree structure for UI rendering
 * - FlatListBuilder: Builds the flat list for API consumption
 */
export class Transformer {
  private messageMap: Map<string, Message>;
  private nodeIdCounter = 0;

  // Utility classes
  private branchResolver: BranchResolver;
  private messageCollector: MessageCollector;
  private messageTransformer: MessageTransformer;

  // Builder classes
  private contextTreeBuilder: ContextTreeBuilder;
  private flatListBuilder: FlatListBuilder;

  constructor(private helperMaps: HelperMaps) {
    this.messageMap = helperMaps.messageMap;

    // Initialize utility classes
    this.branchResolver = new BranchResolver();
    this.messageCollector = new MessageCollector(
      this.messageMap,
      helperMaps.childrenMap,
      this.branchResolver,
    );
    this.messageTransformer = new MessageTransformer();

    // Initialize builder classes
    this.contextTreeBuilder = new ContextTreeBuilder(
      helperMaps.messageMap,
      helperMaps.messageGroupMap,
      this.branchResolver,
      this.messageCollector,
      this.generateNodeId.bind(this),
    );

    this.flatListBuilder = new FlatListBuilder(
      helperMaps.messageMap,
      helperMaps.messageGroupMap,
      helperMaps.childrenMap,
      this.branchResolver,
      this.messageCollector,
      this.messageTransformer,
    );
  }

  /**
   * Generates a unique node ID
   */
  private generateNodeId(prefix: string, messageId: string): string {
    return `${prefix}-${messageId}-${this.nodeIdCounter++}`;
  }

  /**
   * Transform all root nodes to contextTree
   * Returns a linear array of context nodes for UI rendering
   */
  transformAll(idNodes: IdNode[]): ContextNode[] {
    return this.contextTreeBuilder.transformAll(idNodes);
  }

  /**
   * Generate flatList from messages array
   * Only includes messages in the active path for API consumption
   */
  flatten(messages: Message[]): Message[] {
    return this.flatListBuilder.flatten(messages);
  }
}
