import type {
  AgentCouncilNode,
  AssistantGroupNode,
  BranchNode,
  CompareNode,
  ContextNode,
  IdNode,
  Message,
  MessageGroupMetadata,
  MessageNode,
  TasksNode,
} from '../types';
import type { BranchResolver } from './BranchResolver';
import type { MessageCollector } from './MessageCollector';

/**
 * ContextTreeBuilder - Transforms IdNode tree into ContextNode tree
 *
 * Handles:
 * 1. Tree traversal with priority-based node type detection
 * 2. Creating different types of ContextNodes (Message, Branch, Compare, AssistantGroup, AgentCouncil, Tasks)
 * 3. Linear array output of the tree structure
 */
export class ContextTreeBuilder {
  constructor(
    private messageMap: Map<string, Message>,
    private messageGroupMap: Map<string, MessageGroupMetadata>,
    private branchResolver: BranchResolver,
    private messageCollector: MessageCollector,
    private generateNodeId: (prefix: string, messageId: string) => string,
  ) {}

  /**
   * Transform all root nodes to contextTree
   * Returns a linear array of context nodes
   */
  transformAll(idNodes: IdNode[]): ContextNode[] {
    const contextTree: ContextNode[] = [];

    this.runLinear(idNodes, contextTree);

    return contextTree;
  }

  /**
   * Depth-first drive of `transformToLinear` over an explicit stack.
   *
   * A conversation's tree depth equals its length (each turn parents off the
   * previous one), so recursing per node overflows the stack on long chains.
   * Continuations are returned in visit order and pushed reversed.
   */
  private runLinear(seed: IdNode[], contextTree: ContextNode[]): void {
    const stack: IdNode[] = [];
    for (let i = seed.length - 1; i >= 0; i--) stack.push(seed[i]);

    while (stack.length > 0) {
      const next = this.transformToLinear(stack.pop()!, contextTree);
      for (let i = next.length - 1; i >= 0; i--) stack.push(next[i]);
    }
  }

  /**
   * Transform a single IdNode, append its node(s) to contextTree, and return the
   * nodes the walk continues into (in visit order).
   */
  private transformToLinear(idNode: IdNode, contextTree: ContextNode[]): IdNode[] {
    const message = this.messageMap.get(idNode.id);
    if (!message) return [];

    // Priority 1: Compare mode from user message metadata
    if (this.isCompareMode(message) && idNode.children.length > 1) {
      // Add user message node
      const messageNode = this.createMessageNode(message);
      contextTree.push(messageNode);

      // Create compare node with children
      const compareNode = this.createCompareNodeFromChildren(message, idNode);
      contextTree.push(compareNode);

      // Continue with active column's children (if any)
      if (compareNode.activeColumnId) {
        // Find the active column's IdNode in the children
        const activeColumnIdNode = idNode.children.find(
          (child) => child.id === compareNode.activeColumnId,
        );
        if (activeColumnIdNode && activeColumnIdNode.children.length > 0) {
          return [activeColumnIdNode.children[0]];
        }
      }
      return [];
    }

    // Priority 2: Compare mode (from messageGroup metadata)
    const messageGroup = message.groupId ? this.messageGroupMap.get(message.groupId) : undefined;

    if (messageGroup && messageGroup.mode === 'compare') {
      // Create compare node
      const compareNode = this.createCompareNode(messageGroup, message);
      contextTree.push(compareNode);

      // Continue with active column's children (if any)
      if (compareNode.activeColumnId) {
        // Find the active column's IdNode in the children
        const activeColumnIdNode = idNode.children.find(
          (child) => child.id === compareNode.activeColumnId,
        );
        if (activeColumnIdNode && activeColumnIdNode.children.length > 0) {
          return [activeColumnIdNode.children[0]];
        }
      }
      return [];
    }

    // Priority 3: AgentCouncil mode (from message metadata, typically on tool messages)
    if (this.isAgentCouncilMode(message) && idNode.children.length > 1) {
      // Create agent council node with children
      const agentCouncilNode = this.createAgentCouncilNodeFromChildren(message, idNode);
      contextTree.push(agentCouncilNode);

      // Continue from every member to surface the supervisor's post-council reply.
      // The reply attaches to exactly ONE member, but which member is non-deterministic:
      // broadcast agents finish near-simultaneously so their createdAt values tie, and the
      // writer anchors the reply to the createdAt-last member while the tree preserves
      // input-array order — the two can disagree. Walking only children.at(-1) would strand
      // the reply. Only the member carrying it has children, so iterating every member emits
      // it exactly once and keeps contextTree in agreement with flatList (FlatListBuilder
      // applies the same all-member continuation).
      return idNode.children
        .filter((child) => child.children.length > 0)
        .map((child) => child.children[0]);
    }

    // Priority 3b: Tasks aggregation (multiple task children with same parent)
    if (this.isTasksNode(idNode)) {
      const tasksNode = this.createTasksNode(message, idNode);
      contextTree.push(tasksNode);

      // Continue with non-task children (e.g., final summary from assistant)
      const nonTaskChildren = idNode.children.filter((child) => {
        const childMsg = this.messageMap.get(child.id);
        return childMsg?.role !== 'task';
      });

      // Also check for children of task messages (e.g., summary as child of last task)
      const taskChildren = idNode.children.filter((child) => {
        const childMsg = this.messageMap.get(child.id);
        return childMsg?.role === 'task';
      });

      const taskGrandchildren = taskChildren.flatMap((taskChild) =>
        taskChild.children.filter((taskGrandchild) => {
          const taskGrandchildMsg = this.messageMap.get(taskGrandchild.id);
          return taskGrandchildMsg && taskGrandchildMsg.role !== 'task';
        }),
      );

      return [...nonTaskChildren, ...taskGrandchildren];
    }

    // Priority 4: AssistantGroup (assistant + tools)
    if (this.isAssistantGroupNode(message, idNode)) {
      const assistantGroupNode = this.createAssistantGroupNode(message, idNode);
      contextTree.push(assistantGroupNode);

      // Find the next message after tools
      const nextMessage = this.messageCollector.findNextAfterTools(message, idNode);
      return nextMessage ? [nextMessage] : [];
    }

    // Priority 6: Branch — multiple NON-TOOL children (dual-form reader invariant: tool children are inline data, not branch candidates).
    // Tool children are inline data of their assistant (handled by Priority 4),
    // never branch candidates.
    const nonToolChildren = idNode.children.filter(
      (child) => this.messageMap.get(child.id)?.role !== 'tool',
    );
    if (nonToolChildren.length > 1) {
      // Add current message node
      const messageNode = this.createMessageNode(message);
      contextTree.push(messageNode);

      // Create branch node
      const branchNode = this.createBranchNode(message, idNode);
      contextTree.push(branchNode);

      // Don't continue after branch - branch is an end point
      return [];
    }

    // Priority 7: Regular message
    const messageNode = this.createMessageNode(message);
    contextTree.push(messageNode);

    // Continue with single child
    return idNode.children.length === 1 ? [idNode.children[0]] : [];
  }

  /**
   * Check if message has compare mode in metadata
   */
  private isCompareMode(message: Message): boolean {
    return (message.metadata as any)?.compare === true;
  }

  /**
   * Check if message has agentCouncil mode in metadata
   * Used for multi-agent parallel responses (broadcast scenario)
   */
  private isAgentCouncilMode(message: Message): boolean {
    return (message.metadata as any)?.agentCouncil === true;
  }

  /**
   * Check if this is Assistant + Tools pattern
   */
  private isAssistantGroupNode(message: Message, idNode: IdNode): boolean {
    if (message.role !== 'assistant') return false;

    // Role-aware (dual-form reader): an assistant heads a group when it has ANY tool
    // child — not only when ALL children are tools. In the assistant-anchored
    // form the next step's assistant is a sibling of the tool results, so a
    // group head legitimately has a mix of tool + assistant children. (In the
    // old tool-anchored form a tool-using assistant only ever had tool children,
    // so this stays a no-op for legacy data.)
    return (
      idNode.children.some((child) => this.messageMap.get(child.id)?.role === 'tool') ||
      this.messageCollector.isToolChainHead(message)
    );
  }

  /**
   * Create MessageNode (leaf node)
   * Uses the message's own id directly
   */
  private createMessageNode(message: Message): MessageNode {
    return {
      id: message.id,
      type: 'message',
    };
  }

  /**
   * Create AssistantGroupNode
   * Collects all assistant messages in the sequence (with or without tools)
   */
  private createAssistantGroupNode(message: Message, idNode: IdNode): AssistantGroupNode {
    const children: ContextNode[] = [];

    // Recursively collect all assistant messages in this group
    this.messageCollector.collectAssistantGroupMessages(message, idNode, children);

    // Append external-signal callback blocks () at the END of
    // children — one block per source tool that fired callbacks. They
    // ride INSIDE the AssistantGroup but BELOW the main-chain zigzag,
    // since the toolless reactive replies aren't part of the
    // assistant → tool → assistant chain MessageCollector walks.
    const signalCallbacks = this.messageCollector.collectSignalCallbacks(message, idNode);
    children.push(...signalCallbacks);

    // After the callbacks block, append the post-task-summary turns
    // () — toolless assistants tagged with
    // `signal.type === 'task-completion'`, fired by the LLM after CC's
    // `task_notification` ended a long-running tool. They're peers of
    // the callbacks under the same tool_result; collecting them here
    // keeps the natural narrative inside ONE AssistantGroup:
    //   initial reply → SignalCallbacks (collapsible) → summary.
    const taskCompletions = this.messageCollector.collectTaskCompletions(message, idNode);
    children.push(...taskCompletions);

    return {
      children,
      id: message.id,
      type: 'assistantGroup',
    };
  }

  /**
   * Create BranchNode
   */
  private createBranchNode(message: Message, idNode: IdNode): BranchNode {
    const activeBranchId = this.branchResolver.getActiveBranchId(message, idNode);

    // For optimistic update (activeBranchId is undefined), use children.length as the index
    // This indicates the branch is being created but doesn't exist yet
    const activeBranchIndex = activeBranchId
      ? idNode.children.findIndex((child) => child.id === activeBranchId)
      : idNode.children.length;

    // Each branch is a tree starting from that child
    const branches = idNode.children.map((child) => {
      const branchTree: ContextNode[] = [];
      this.runLinear([child], branchTree);
      return branchTree;
    });

    return {
      activeBranchIndex: activeBranchIndex >= 0 ? activeBranchIndex : 0,
      branches,
      id: this.generateNodeId('branch', message.id),
      parentMessageId: message.id,
      type: 'branch',
    };
  }

  /**
   * Create CompareNode from children messages
   */
  private createCompareNodeFromChildren(message: Message, idNode: IdNode): CompareNode {
    // Find active column ID from children metadata
    let activeColumnId: string | undefined;

    // Each child is a column - need to recursively process to handle AssistantGroup
    const columns = idNode.children.map((child) => {
      const childMessage = this.messageMap.get(child.id);
      if (!childMessage) {
        return [
          {
            id: child.id,
            type: 'message',
          } as MessageNode,
        ];
      }

      // Check if this message is marked as active column
      if ((childMessage.metadata as any)?.activeColumn === true) {
        activeColumnId = child.id;
      }

      // Check if this column should be an AssistantGroup
      if (this.isAssistantGroupNode(childMessage, child)) {
        const assistantGroupNode = this.createAssistantGroupNode(childMessage, child);
        return [assistantGroupNode];
      }

      // Otherwise, just a simple MessageNode
      return [
        {
          id: child.id,
          type: 'message',
        } as MessageNode,
      ];
    });

    // Generate ID by joining parent message id and all column message ids
    const columnIds = idNode.children.map((child) => child.id).join('-');
    const compareId = `compare-${message.id}-${columnIds}`;

    return {
      activeColumnId,
      columns,
      id: compareId,
      messageId: message.id,
      type: 'compare',
    };
  }

  /**
   * Create CompareNode from message group
   */
  private createCompareNode(group: MessageGroupMetadata, message: Message): CompareNode {
    // Collect all messages in this group
    const groupMessages: Message[] = [];
    for (const msg of this.messageMap.values()) {
      if (msg.groupId === group.id) {
        groupMessages.push(msg);
      }
    }

    // Find active column ID from group messages metadata
    const activeColumnId = groupMessages.find(
      (msg) => (msg.metadata as any)?.activeColumn === true,
    )?.id;

    // Each column is a message tree
    const columns = groupMessages.map((msg) => {
      const messageNode: MessageNode = {
        id: msg.id,
        type: 'message',
      };
      return [messageNode];
    });

    return {
      activeColumnId,
      columns,
      id: this.generateNodeId('compare', group.id),
      messageId: group.parentMessageId || message.id,
      type: 'compare',
    };
  }

  /**
   * Create AgentCouncilNode from children messages
   * Similar to CompareNode but without activeColumnId (all members enter context)
   */
  private createAgentCouncilNodeFromChildren(message: Message, idNode: IdNode): AgentCouncilNode {
    // Each child is a member - process to handle potential AssistantGroup
    const members = idNode.children.map((child) => {
      const childMessage = this.messageMap.get(child.id);
      if (!childMessage) {
        return { id: child.id, type: 'message' } as MessageNode;
      }

      // Check if this member should be an AssistantGroup (agent with tool calls)
      if (this.isAssistantGroupNode(childMessage, child)) {
        return this.createAssistantGroupNode(childMessage, child);
      }

      // Otherwise, just a simple MessageNode
      return { id: child.id, type: 'message' } as MessageNode;
    });

    // Generate ID by joining parent message id and all member message ids
    const memberIds = idNode.children.map((child) => child.id).join('-');
    const agentCouncilId = `agentCouncil-${message.id}-${memberIds}`;

    return { id: agentCouncilId, members, messageId: message.id, type: 'agentCouncil' };
  }

  /**
   * Check if this node has multiple task children (tasks aggregation pattern)
   */
  private isTasksNode(idNode: IdNode): boolean {
    if (idNode.children.length < 2) return false;

    const taskChildren = idNode.children.filter((child) => {
      const childMsg = this.messageMap.get(child.id);
      return childMsg?.role === 'task';
    });

    return taskChildren.length > 1;
  }

  /**
   * Create TasksNode from multiple task children
   */
  private createTasksNode(message: Message, idNode: IdNode): TasksNode {
    // Filter only task children and create message nodes for them
    const taskChildren = idNode.children.filter((child) => {
      const childMsg = this.messageMap.get(child.id);
      return childMsg?.role === 'task';
    });

    const children: ContextNode[] = taskChildren.map((child) => ({
      id: child.id,
      type: 'message' as const,
    }));

    // Generate ID by joining parent message id and all task message ids
    const taskIds = taskChildren.map((child) => child.id).join('-');
    const tasksId = `tasks-${message.id}-${taskIds}`;

    return {
      children,
      id: tasksId,
      messageId: message.id,
      type: 'tasks',
    };
  }
}
