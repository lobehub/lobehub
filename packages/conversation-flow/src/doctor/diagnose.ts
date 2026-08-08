import { parse } from '../parse';
import type { Message, MessageGroupMetadata } from '../types';
import type { RepairOp, TopicDiagnosis, TopicIssue } from './types';

/**
 * Every message id referenced anywhere in the rendered payload.
 *
 * The renderer does not emit one flat entry per message: tool results live in
 * `children[].tools[].result_msg_id`, signal turns in `signalCallbacks[]`, post-task
 * summaries in `taskCompletions[]`, and so on. Rather than mirror each nesting site
 * (and silently start over-reporting whenever a new one is added), walk the payload
 * generically and collect anything that could be a message id. Ids that are not
 * messages (tool_call ids) fall out when the set is intersected with the topic.
 */
const collectRenderedIds = (node: unknown, out: Set<string>): void => {
  if (Array.isArray(node)) {
    for (const item of node) collectRenderedIds(item, out);
    return;
  }
  if (!node || typeof node !== 'object') return;

  const record = node as Record<string, unknown>;
  for (const key of ['id', 'result_msg_id', 'sourceToolMessageId']) {
    const value = record[key];
    if (typeof value === 'string') out.add(value);
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') collectRenderedIds(value, out);
  }
};

/** A toolless assistant tagged with a signal — a reactive callback turn, not a main-chain step. */
const getSignal = (message: Message): { sourceToolCallId?: string } | undefined => {
  if (message.role !== 'assistant') return undefined;
  if (message.tools && message.tools.length > 0) return undefined;
  return (message.metadata as { signal?: { sourceToolCallId?: string } } | null | undefined)
    ?.signal;
};

/**
 * Anything the user would actually see if this message were put back on screen. An error, a
 * reasoning block or an audio clip is as visible as text — a message carrying only one of
 * those is still worth restoring.
 *
 * Token accounting deliberately does not count: a turn-final assistant with usage but no
 * text renders nothing.
 */
const hasSubstance = (message: Message): boolean =>
  !!message.content?.trim() ||
  !!message.reasoning ||
  !!message.error ||
  !!message.tools?.length ||
  !!message.imageList?.length ||
  !!message.fileList?.length ||
  !!message.audioList?.length;

/**
 * An assistant that carries nothing at all: the writer created the row but its content and
 * tool calls never landed. Derived from `hasSubstance` rather than restating it, so the two
 * cannot drift — a shape counted as visible must never also be counted as an empty shell.
 *
 * Usage is the one exception: a turn-final assistant with tokens but no content is a
 * legitimate shape (the group aggregates them), not a row that failed to be written.
 */
const isEmptyShell = (message: Message): boolean =>
  message.role === 'assistant' &&
  !hasSubstance(message) &&
  !message.usage &&
  !(message.metadata as { usage?: unknown } | null | undefined)?.usage;

/** Mirrors the write-side anchor rule: tool messages and toolless signal turns are never a spine tail. */
const canAnchor = (message: Message): boolean =>
  message.role !== 'tool' && !getSignal(message) && !isEmptyShell(message);

const timeSpan = (messages: Message[]): [number, number] => [
  Math.min(...messages.map((m) => m.createdAt)),
  Math.max(...messages.map((m) => m.createdAt)),
];

const overlaps = (a: [number, number], b: [number, number]): boolean =>
  a[0] <= b[1] && b[0] <= a[1];

/**
 * Diagnose a topic's message tree.
 *
 * Ground truth for "the user cannot see this message" is the renderer itself: run the
 * real `parse()` and diff its output against the tree. That diff is only a *candidate*
 * set though — the losing side of a regenerate branch is unreachable by design. So each
 * candidate is then attributed to a known defect shape, and only attributed messages are
 * reported. Anything we cannot explain is left alone.
 */
export const diagnoseTopic = (
  messages: Message[],
  messageGroups?: MessageGroupMetadata[],
): TopicDiagnosis => {
  const mainFlow = messages.filter((m) => !m.threadId);
  if (mainFlow.length === 0) return { hiddenCount: 0, issues: [], patch: [] };

  const sorted = [...mainFlow].sort((a, b) => a.createdAt - b.createdAt);
  const byId = new Map(sorted.map((m) => [m.id, m]));

  const childrenOf = new Map<string, Message[]>();
  for (const message of sorted) {
    if (!message.parentId || !byId.has(message.parentId)) continue;
    const siblings = childrenOf.get(message.parentId) ?? [];
    siblings.push(message);
    childrenOf.set(message.parentId, siblings);
  }

  const subtreeOf = (rootId: string): Message[] => {
    const collected: Message[] = [];
    const seen = new Set<string>();
    const stack = [rootId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const message = byId.get(id);
      if (message) collected.push(message);
      for (const child of childrenOf.get(id) ?? []) stack.push(child.id);
    }
    return collected;
  };

  const renderedIds = new Set<string>();
  collectRenderedIds(parse(messages, messageGroups).flatList, renderedIds);
  const isHidden = (message: Message) => !renderedIds.has(message.id);

  /**
   * The messages a repair would put back on screen — but only if at least one of them is
   * worth putting back. A dropped turn that is itself empty (an empty callback turn, say)
   * costs the user nothing, and rewriting their history to restore a blank is not a repair.
   */
  const restorable = (candidates: Message[]): string[] => {
    const hiddenOnes = candidates.filter((m) => isHidden(m));
    return hiddenOnes.some((m) => hasSubstance(m)) ? hiddenOnes.map((m) => m.id) : [];
  };

  const issues: TopicIssue[] = [];
  const patch: RepairOp[] = [];
  const hidden = new Set<string>();

  const report = (issue: TopicIssue, op?: RepairOp) => {
    issues.push(issue);
    for (const id of issue.hiddenMessageIds) hidden.add(id);
    if (op) patch.push(op);
  };

  // 0. Segment split: the client sent a turn while its local message list was still empty, so
  //    the new turn landed with no parent (or a parent that never synced) and became a second
  //    root. Every root but the earliest is a section that broke off mid-conversation: the
  //    reader still shows it, but on its own root it sorts by tree order rather than time —
  //    scrambling the transcript — and, worse, it starts a fresh parent chain, so the model
  //    loses all the history before it.
  //
  //    Unlike the reachability rules this one is not "the message is hidden" — it is "the
  //    message is stranded". It is disjoint from the fork/branch rules by construction: those
  //    walk `childrenOf`, which only links messages to a parent that exists, so a root is
  //    never one of their branches.
  const roots = sorted.filter((m) => !m.parentId || !byId.has(m.parentId));
  if (roots.length > 1) {
    // The earliest root is the conversation's real start and stays put; the rest are splits.
    const [, ...strandedRoots] = roots;
    for (const root of strandedRoots) {
      // A stranded section always begins with a user turn — an assistant with no parent is a
      // murkier shape (a lost seed, not a re-entry), so leave it for a human to look at.
      if (root.role !== 'user') continue;

      const section = subtreeOf(root.id);
      if (!section.some((m) => hasSubstance(m))) continue;

      // Reattach to the tail of what came before: the most recent real spine message written
      // before this section began. Tool results and signal turns are never a spine tail, and
      // a message inside this very section can't anchor it.
      const sectionIds = new Set(section.map((m) => m.id));
      const anchor = sorted
        .filter((m) => canAnchor(m) && m.createdAt < root.createdAt && !sectionIds.has(m.id))
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      if (!anchor) continue;

      report(
        {
          hiddenMessageIds: [],
          kind: 'segment-split',
          messageId: root.id,
          reattachedMessageIds: section.map((m) => m.id),
          repairable: true,
        },
        { messageId: root.id, parentId: anchor.id, type: 'reparent' },
      );
    }
  }

  // 1. Concurrent fork: a user turn started while the previous run was still writing, so the
  //    run's remaining steps and the new turn both hang off the same pre-fork anchor. The
  //    reader can only follow one of them. Distinguishing this from a regenerate branch is
  //    the time overlap: a branch the user *chose* starts after its sibling is finished.
  for (const [parentId, allChildren] of childrenOf) {
    const branches = allChildren.filter((m) => m.role !== 'tool');
    if (branches.length < 2) continue;

    const userTurns = branches.filter((m) => m.role === 'user');
    const continuations = branches.filter((m) => m.role === 'assistant');
    if (userTurns.length === 0 || continuations.length === 0) continue;

    for (const userTurn of userTurns) {
      const userSubtree = subtreeOf(userTurn.id);
      const userSpan = timeSpan(userSubtree);

      for (const continuation of continuations) {
        const runSubtree = subtreeOf(continuation.id);
        if (!overlaps(userSpan, timeSpan(runSubtree))) continue;

        // The assistant branch is the interrupted run finishing its turn — it keeps the
        // anchor. The user's message belongs after that run, on the tail of its spine.
        const runIds = new Set(runSubtree.map((m) => m.id));
        const anchor = [...runSubtree]
          .filter((m) => canAnchor(m))
          .sort((a, b) => b.createdAt - a.createdAt)[0];

        // The shape is wrong, but if the reader still gets everything on screen there is
        // nothing to fix and no reason to rewrite the user's history.
        const hiddenHere = restorable([...userSubtree, ...runSubtree]);
        if (hiddenHere.length === 0) continue;

        report(
          {
            hiddenMessageIds: hiddenHere,
            kind: 'concurrent-fork',
            messageId: parentId,
            repairable: !!anchor && !runIds.has(userTurn.id),
          },
          anchor && !runIds.has(userTurn.id)
            ? { messageId: userTurn.id, parentId: anchor.id, type: 'reparent' }
            : undefined,
        );
      }
    }
  }

  // 2. Orphan signal turn: a toolless callback turn must hang off the tool message that
  //    triggered it. Parented off an assistant it falls between two stools — the main chain
  //    filters signal turns out, and the signal collectors only scan a tool's children.
  //
  //    Being mis-parented is not enough to act on, though: depending on the surrounding
  //    chain the reader sometimes still surfaces it. Only the ones it genuinely drops are
  //    reported — the renderer, not the shape, decides what counts as broken.
  for (const message of sorted) {
    const signal = getSignal(message);
    if (!signal || !message.parentId) continue;
    if (byId.get(message.parentId)?.role === 'tool') continue;

    const ownSubtree = subtreeOf(message.id);
    const hiddenHere = restorable(ownSubtree);
    if (hiddenHere.length === 0) continue;

    const ownIds = new Set(ownSubtree.map((m) => m.id));
    const candidates = sorted.filter(
      (m) => m.role === 'tool' && m.createdAt < message.createdAt && !ownIds.has(m.id),
    );
    // The signal names the tool call it is reacting to; fall back to the most recent tool
    // result only when that call cannot be found.
    const anchor =
      candidates.find((m) => m.tool_call_id && m.tool_call_id === signal.sourceToolCallId) ??
      candidates.at(-1);

    report(
      {
        hiddenMessageIds: hiddenHere,
        kind: 'orphan-signal-turn',
        messageId: message.id,
        repairable: !!anchor,
      },
      anchor ? { messageId: message.id, parentId: anchor.id, type: 'reparent' } : undefined,
    );
  }

  // 3. Stale branch index: `activeBranchIndex === children.length` is the legitimate
  //    "the branch is being created" state during streaming. Left behind on a finished turn —
  //    the regenerate was aborted, so the branch never materialised — the resolver returns
  //    nothing and every branch under that message disappears. Point the index back at the
  //    newest branch that does exist, which is as close to the intent as we can get.
  //
  //    Branch resolution only runs when there is a choice to make, so a stale index above a
  //    single child changes nothing and must be left alone. Getting this wrong means
  //    silently flipping which regenerate a user chose to keep.
  for (const [parentId, allChildren] of childrenOf) {
    const parent = byId.get(parentId);
    const branches = allChildren.filter((m) => m.role !== 'tool');
    if (!parent || branches.length < 2) continue;

    const index = (parent.metadata as { activeBranchIndex?: number } | null | undefined)
      ?.activeBranchIndex;
    if (typeof index !== 'number' || index < branches.length) continue;

    // Out of bounds for every branch, so the reader shows none of them — unlike a valid
    // index, where the branches it passes over are the ones the user discarded.
    const hiddenHere = restorable(branches.flatMap((branch) => subtreeOf(branch.id)));
    if (hiddenHere.length === 0) continue;

    report(
      {
        hiddenMessageIds: hiddenHere,
        kind: 'stale-branch-index',
        messageId: parentId,
        repairable: true,
      },
      { index: branches.length - 1, messageId: parentId, type: 'set-branch-index' },
    );
  }

  // 4. Lost content: rows the writer created but never filled in. They are absorbed into the
  //    assistant group as empty blocks rather than shown as blank bubbles, so there is
  //    nothing to re-link and nothing to delete that the user would notice — the text simply
  //    never reached the database. Only a *run* of them is worth reporting: a lone turn-final
  //    shell is a harmless artifact, whereas consecutive shells mean a whole stretch of the
  //    conversation was dropped on the way in, and that is worth saying out loud.
  // The newest message may be a placeholder a live run is still filling in.
  const newestId = sorted.at(-1)?.id;
  const shells = new Set(
    sorted.filter((m) => isEmptyShell(m) && m.parentId && m.id !== newestId).map((m) => m.id),
  );

  // Chains are parent-linked, not adjacent in time — a tool result can land between two
  // shells of the same broken run.
  for (const message of sorted) {
    if (!shells.has(message.id)) continue;
    if (message.parentId && shells.has(message.parentId)) continue; // not the head of its chain

    const chain: Message[] = [];
    let cursor: Message | undefined = message;
    while (cursor) {
      chain.push(cursor);
      cursor = (childrenOf.get(cursor.id) ?? []).find((c) => shells.has(c.id));
    }
    if (chain.length < 2) continue;

    report({
      hiddenMessageIds: [],
      kind: 'lost-content',
      lostMessageIds: chain.map((m) => m.id),
      messageId: chain[0].id,
      repairable: false,
    });
  }

  return { hiddenCount: hidden.size, issues, patch };
};
