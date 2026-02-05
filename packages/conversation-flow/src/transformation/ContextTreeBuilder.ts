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

    for (const idNode of idNodes) {
      this.transformToLinear(idNode, contextTree);
    }

    return contextTree;
  }

  /**
   * Transform a single IdNode and append to contextTree array
   */
  private transformToLinear(idNode: IdNode, contextTree: ContextNode[]): void {
    const message = this.messageMap.get(idNode.id);
    if (!message) return;

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
          this.transformToLinear(activeColumnIdNode.children[0], contextTree);
        }
      }
      return;
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
          this.transformToLinear(activeColumnIdNode.children[0], contextTree);
        }
      }
      return;
    }

    // Priority 3: AgentCouncil mode (from message metadata, typically on tool messages)
    if (this.isAgentCouncilMode(message) && idNode.children.length > 1) {
      // Create agent council node with children
      const agentCouncilNode = this.createAgentCouncilNodeFromChildren(message, idNode);
      contextTree.push(agentCouncilNode);

      // Continue processing children of the last member (for supervisor final reply)
      // The supervisor's reply has parentId pointing to the last agent's message
      const lastChild = idNode.children.at(-1);
      if (lastChild && lastChild.children.length > 0) {
        // Process the first child of the last agent (supervisor's reply)
        this.transformToLinear(lastChild.children[0], contextTree);
      }
      return;
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

      for (const nonTaskChild of nonTaskChildren) {
        this.transformToLinear(nonTaskChild, contextTree);
      }

      // Also check for children of task messages (e.g., summary as child of last task)
      const taskChildren = idNode.children.filter((child) => {
        const childMsg = this.messageMap.get(child.id);
        return childMsg?.role === 'task';
      });

      for (const taskChild of taskChildren) {
        for (const taskGrandchild of taskChild.children) {
          const taskGrandchildMsg = this.messageMap.get(taskGrandchild.id);
          if (taskGrandchildMsg && taskGrandchildMsg.role !== 'task') {
            this.transformToLinear(taskGrandchild, contextTree);
          }
        }
      }
      return;
    }

    // Priority 4: AssistantGroup (assistant + tools)
    if (this.isAssistantGroupNode(message, idNode)) {
      const assistantGroupNode = this.createAssistantGroupNode(message, idNode);
      contextTree.push(assistantGroupNode);

      // Find the next message after tools
      const nextMessage = this.messageCollector.findNextAfterTools(message, idNode);
      if (nextMessage) {
        this.transformToLinear(nextMessage, contextTree);
      }
      return;
    }

    // Priority 6: Branch (multiple children)
    if (idNode.children.length > 1) {
      // Add current message node
      const messageNode = this.createMessageNode(message);
      contextTree.push(messageNode);

      // Create branch node
      const branchNode = this.createBranchNode(message, idNode);
      contextTree.push(branchNode);

      // Don't continue after branch - branch is an end point
      return;
    }

    // Priority 7: Regular message
    const messageNode = this.createMessageNode(message);
    contextTree.push(messageNode);

    // Continue with single child
    if (idNode.children.length === 1) {
      this.transformToLinear(idNode.children[0], contextTree);
    }
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

    return (
      idNode.children.length > 0 &&
      idNode.children.every((child) => {
        const childMsg = this.messageMap.get(child.id);
        return childMsg?.role === 'tool';
      })
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
      this.transformToLinear(child, branchTree);
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
