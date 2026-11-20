export const documentBlocksPrompt = `<rich_blocks>
Besides paragraphs, headings, lists, quotes, code, images, files and tables, documents support the blocks below. Use them when they fit the content; each one round-trips through LiteXML and Markdown.

- **Callout**: \`<alert type="note|tip|important|warning|caution">\` holding block content (paragraphs, lists, code). Markdown: a blockquote whose first line is \`[!NOTE]\`, \`[!TIP]\`, \`[!IMPORTANT]\`, \`[!WARNING]\` or \`[!CAUTION]\`.
- **Chart**: \`<chart>\` holding one JSON spec in CDATA. It renders as a live, editable chart, so prefer it over a table or an image when the reader needs to see a trend, a comparison or a share. Markdown: a fenced block with the language \`chart\` holding the same JSON.
  - Spec: \`{"version":1,"type":"bar|line|area|pie","x":"<category field>","series":[{"key":"<numeric field>","label":"<display name>"}],"data":[{...}]}\`. Every row has the \`x\` field and one number per series key; \`pie\` plots only the first series.
  - Optional fields: \`title\`, \`subtitle\`, \`note\`, \`source\`, \`xLabel\`, \`stacked\` (bar/area), \`donut\` (pie), \`highlight\` (a series key), \`format\` (\`{"unit":"$","compact":true,"decimals":1,"signed":false}\`), \`y\` (\`{"min":0,"max":100}\`), \`refs\` (\`[{"y":50,"label":"Target"}]\`). Unknown fields are dropped and an invalid spec renders as an error card.
- **Footnotes**: put \`<footnote ref="<id>"/>\` where the note applies and the definitions in a single \`<footnote-section>\` at the end of the document, one \`<def ref="<id>">\` each. Markdown: \`[^id]\` in the text and \`[^id]: definition\` on its own line.
- **Column alignment**: \`<table colAligns="left,center,right">\`, one entry per column; leave an entry empty for the default.

LiteXML example:
\`\`\`xml
<alert type="tip"><p>Edit the numbers in the chart to update it.</p></alert>
<chart><![CDATA[{"version":1,"type":"line","title":"Weekly active users","x":"week","series":[{"key":"users","label":"Users"}],"data":[{"week":"W1","users":120},{"week":"W2","users":180}]}]]></chart>
<p>Growth came from the new onboarding<footnote ref="1"/>.</p>
<table colAligns="left,right"><tr><th>Week</th><th>Users</th></tr><tr><td>W2</td><td>180</td></tr></table>
<footnote-section><def ref="1">Shipped in week 2.</def></footnote-section>
\`\`\`

Markdown example:
\`\`\`\`markdown
> [!WARNING]
> Back up the workspace before migrating.

\`\`\`chart
{"version":1,"type":"bar","x":"plan","series":[{"key":"seats","label":"Seats"}],"data":[{"plan":"Free","seats":40},{"plan":"Pro","seats":25}]}
\`\`\`

Seats are counted at the end of the month[^1].

[^1]: Trial seats are excluded.
\`\`\`\`
</rich_blocks>`;
