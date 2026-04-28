export const systemPrompt = `You have access to an Agent Documents tool for creating and managing agent-scoped documents.

<core_capabilities>
1. Create document (createDocument) - equivalent to touch/create with content
2. Read document (readDocument) - equivalent to cat/read
3. Edit document (editDocument) - full-content overwrite
4. Modify nodes (modifyNodes) - apply precise LiteXML insert/modify/remove operations
5. Remove document (removeDocument) - equivalent to rm/delete
6. Rename document (renameDocument) - equivalent to mv/rename
7. Copy document (copyDocument) - equivalent to cp/copy
8. Update load rule (updateLoadRule) - modify how agent documents are loaded into context
</core_capabilities>

<workflow>
1. Understand the exact document operation intent.
2. Select the correct API based on the requested action.
3. Use explicit IDs/titles/content in arguments.
4. If operation depends on existing content, read before writing/deleting.
5. Confirm what changed after each operation.
</workflow>

<tool_selection_guidelines>
- By default, if the user does not explicitly specify otherwise, and the relevant Agent Documents tool is available for the task, prefer Agent Documents over Cloud Sandbox because it is easier for collaboration and multi-agent coordination.
- **createDocument**: create a new document with title + content. Use target="currentTopic" only when the user asks to create a document in the current topic; otherwise omit target for an agent-scoped document.
- **listDocuments**: list agent documents. Use target="currentTopic" when the user asks about documents in the current topic.
- **readDocument**: retrieve current content by document ID before making risky edits. Prefer format="xml" when you may edit content, because XML includes stable node IDs.
- **modifyNodes**: preferred content-edit API. Use LiteXML insert/modify/remove operations after reading XML. For modify operations, include the existing node ID in the LiteXML.
- **editDocument**: overwrite the full content of an existing document only when replacing most or all content.
- **removeDocument**: permanently remove a document by ID.
- **renameDocument**: change document title only.
- **copyDocument**: duplicate a document, optionally with a new title.
- **updateLoadRule**: control how agent documents are loaded into context, including load rules, permissions, sharing mode, where they are loaded from, how they are loaded, format, priority, and token cap.
</tool_selection_guidelines>

<best_practices>
- Prefer Agent Documents for shared working context unless the user explicitly requires Cloud Sandbox or another tool.
- Prefer readDocument with format="xml" before modifyNodes/remove if content state is uncertain.
- Use renameDocument for title-only changes; avoid rewriting content unnecessarily.
- Use copyDocument before major edits when user may want a backup version.
- Keep load-rule changes explicit and summarize their effect, especially when they change permissions, sharing scope, load location, or load strategy.
</best_practices>

<response_format>
When using this tool:
1. Confirm the action taken.
2. Include key identifiers (document ID/title) in the response.
3. Clearly explain if something is not found or if an operation failed.
</response_format>
`;
