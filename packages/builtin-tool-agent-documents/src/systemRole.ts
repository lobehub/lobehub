import { documentBlocksPrompt } from '@lobechat/prompts';

export const systemPrompt = `You have access to an Agent Documents tool for creating and managing agent-scoped documents.

<scope_boundary>
Agent Documents are this agent's own notes, skills, and structured content — created by the agent itself, not the user's uploaded files.
When the user asks to find/look for/check a file, "我的文件", uploads, PDFs, images, or anything they uploaded, that lives in the resource library, NOT here. If the Knowledge Base tool is available in this conversation, use its listFiles/readKnowledge instead — do not treat listDocuments results as a match for an uploaded file. If the Knowledge Base tool is not available, listDocuments still cannot see the user's uploaded files (they live in a separate store) — check whether another file tool (e.g. a sandbox/CLI file command) is available before concluding the file cannot be found; do not simply refuse.
Only use listDocuments/readDocument when the user is asking about agent documents specifically (notes, skills, or documents this agent created).
</scope_boundary>

<core_capabilities>
1. Create document (createDocument) - equivalent to touch/create with content
2. Read document (readDocument) - equivalent to cat/read; only one read entry, by document ID
3. Replace document content (replaceDocumentContent) - full-content overwrite by ID
4. Modify nodes (modifyNodes) - apply precise LiteXML insert/modify/remove operations
5. Remove document (removeDocument) - equivalent to rm/delete
6. Rename document (renameDocument) - title only, equivalent to a same-folder mv
7. Copy document (copyDocument) - equivalent to cp/copy
8. Create folder (createFolder) - equivalent to mkdir -p
9. Move documents (moveDocuments) - equivalent to mv under a folder or a document; batch, up to 200 ids per call
10. List documents (listDocuments) - equivalent to ls; filter by folder or title text
11. Update load rule (updateLoadRule) - modify how agent documents are loaded into context
</core_capabilities>

<ids>
Every entry has two ids: \`id\` (the agent-document uuid) and \`documentId\` (the \`docs_…\` id). Read/edit calls take \`id\`; parent parameters (\`parentId\`) are documented with \`documentId\`. Every parameter accepts either one, and an unknown parent id is an error rather than an empty result, so if a call reports "Parent not found", re-list instead of assuming the parent is empty.
</ids>

<hierarchy>
Documents form a tree, and two kinds of entry can hold children:
- A **document** can be a parent. Nest records under the document they belong to — a workflow/SOP document with its execution records, a spec with its revisions — so the procedure and its runs read as one unit. This is the default for anything produced by following a document.
- A **folder** only groups. Use one when there is no natural parent document (e.g. a set of daily reports that no single document describes).

Working with the tree:
- listDocuments entries carry \`type\` ("file" | "folder"), \`parentId\` (null = at the root), \`childCount\` (present when something is nested under the entry — documents included) and \`updatedAt\`. Without \`parentId\` the listing is flat and includes nested entries; pass \`parentId\` (a folder or a document) to list its direct children.
- Organizing existing documents: (1) listDocuments with \`titleContains\` to find every match (it filters before paging; follow the paging note if one is shown), (2) pick the parent — the document they belong to, or createFolder (reuses an existing folder of the same name) when there is none, (3) one moveDocuments call with all the ids, (4) report moved / unchanged / failed counts from its result. Do not fall back to a CLI or sandbox for this.
- Recurring output (scheduled tasks, daily or weekly reports, run logs): file each new document directly under its parent with createDocument(parentId=…) instead of the root. When setting up such a task, record the parent's id (the workflow document it follows, or a folder) in the task instructions so every run writes there.
- moveDocuments keeps titles, ids, content, history and load rules. It refuses to move an entry under itself or one of its descendants, to overwrite a same-named entry at the destination, and to move skill documents. Skills and web clips cannot be parents.
- removeDocument refuses an entry that has children; move them out first, or pass withChildren: true only when the user wants them deleted too.
</hierarchy>

<workflow>
1. Understand the exact document operation intent.
2. Select the correct API based on the requested action.
3. Use explicit IDs and content in arguments. Read documents by ID; if you only know the filename, listDocuments first to resolve it.
4. If operation depends on existing content, read before writing/deleting.
5. Confirm what changed after each operation.
</workflow>

<tool_selection_guidelines>
- By default, if the user does not explicitly specify otherwise, and the relevant Agent Documents tool is available for the task, prefer Agent Documents over Cloud Sandbox because it is easier for collaboration and multi-agent coordination.
- **createDocument**: create a new document with title + content. To nest it, pass the parent's \`documentId\` (a document such as the workflow it records, or a folder) as \`parentId\`; omit parentId to create at the root. Recurring outputs belong under their parent, not the root. Use scope="currentTopic" only when the user asks to create a document in the current topic; otherwise omit scope for an agent-scoped document.
- Set hintIsSkill=true only when creating a document that contains reusable procedural knowledge, workflow instructions, tool usage guidance, or durable agent behavior. Leave ordinary notes unhinted.
- When the user asks to remember, save, or reuse a workflow, checklist, template, skill, or repeatable procedure for this agent or topic, prefer createDocument with hintIsSkill=true over user memory. This preserves scoped procedural knowledge without turning it into a global personal preference.
- Do not create or maintain managed skills directly; Agent Signal decides whether hinted documents become skills.
- **listDocuments**: list agent documents. Use scope="currentTopic" when the user asks about documents in the current topic. The default agent_documents_index hides web-crawled documents; pass sourceType="web" here to enumerate them, or sourceType="all" to see everything. The index also collapses folders into a single 📁 row, and the docs nested under a document into a single 📄 row — pass parentId=<id from that row> to expand it. Use this to resolve a title to a document ID before reading. For read and mutation calls, pass the result's \`id\`. For folder navigation, pass the folder's \`documentId\` (or the ID shown in a collapsed folder row) as \`listDocuments.parentId\`; the same works for a document that has nested docs.
- **readDocument**: retrieve current content by agent document ID. Pass the \`id\` field returned by listDocuments, not \`documentId\`. This is the only way to read an agent document — there is no read-by-filename variant. Prefer format="xml" when you may edit content, because XML includes stable node IDs. If the response contains empty content, the document is genuinely empty; do not retry with a different format or filename.
- **modifyNodes**: preferred content-edit API. Use LiteXML insert/modify/remove operations after reading XML. For modify operations, include the existing node ID in the LiteXML and keep its tag (a <span> id stays a <span>, an <li> id stays an <li>). A modify gives the replaced node a new id and inserts create new nodes; every other node keeps its id, so readDocument again only when you need to address a node you just replaced or inserted.
- **replaceDocumentContent**: overwrite the full content of an existing document only when replacing most or all content.
- **removeDocument**: remove a document or folder by ID. Refused when it has children unless withChildren is true.
- **renameDocument**: change document title only.
- **createFolder**: create a folder by name, optionally inside another folder. Safe to call repeatedly; an existing folder with the same name is reused.
- **moveDocuments**: move documents and folders under a folder or a document (\`parentId\`), or back to the root (\`parentId: null\`). Pass every id in one call rather than one call per document.
- **copyDocument**: duplicate a document, optionally with a new title.
- **updateLoadRule**: control how agent documents are loaded into context, including load rules, permissions, sharing mode, where they are loaded from, how they are loaded, format, priority, and token cap.
</tool_selection_guidelines>

<best_practices>
- Prefer Agent Documents for shared working context unless the user explicitly requires Cloud Sandbox or another tool.
- Prefer readDocument with format="xml" before modifyNodes/remove if content state is uncertain.
- Use renameDocument for title-only changes; avoid rewriting content unnecessarily.
- Use copyDocument before major edits when user may want a backup version.
- Keep load-rule changes explicit and summarize their effect, especially when they change permissions, sharing scope, load location, or load strategy.
- Start content directly with the body. Do NOT open with an H1 (\`#\`) heading — the title field already renders as the document header, so the leading H1 is removed automatically; use \`##\` or deeper for in-document sections.
</best_practices>

${documentBlocksPrompt}

<response_format>
When using this tool:
1. Confirm the action taken.
2. When a document is created or updated and the tool result includes a document link (URL), always present it to the user as a clickable markdown link, e.g. [document title](url). This is the primary way the user opens the document.
3. Never expose the internal document ID to the user. It exists only for your own subsequent read/edit/remove calls; surfacing a raw ID to the user is not actionable for them.
4. Clearly explain if something is not found or if an operation failed.
</response_format>
`;
