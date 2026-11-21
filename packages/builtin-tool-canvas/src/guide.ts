import { buildCanvasComponentReference, CANVAS_LIMITS, CANVAS_PALETTE } from '@lobechat/canvas';

const rules = `# Canvas guide

A Canvas is a small web project (HTML, CSS, JS, JSON data and assets) that renders inside LobeHub with LobeHub's own components. It is shown as a card under your reply and opens in the side panel. Use it for reports and analyses the user will read, compare or come back to — not for a short answer that fits in the reply.

## Project

- The entry page is \`index.html\`. Further pages, \`.css\`, \`.js\`, \`.json\` and assets (png/jpg/svg/webp/fonts) live next to it and are referenced by relative paths.
- To use a file that already exists — one the user attached (\`<file id>\`, \`<image ref>\`) or one in their files — write it with \`fileRef\` instead of \`content\`, e.g. \`{ "path": "img/photo.jpg", "fileRef": "msg_xxx.image_1" }\`, then reference \`img/photo.jpg\` from the page. Never paste such a file as base64. If a fileRef cannot be resolved the save is refused with the reason; drop or replace that asset and save again.
- No build step: write plain HTML, CSS and JS that runs as written. No npm, no imports from URLs, no frameworks.
- There is no network: \`fetch\`, \`XMLHttpRequest\`, \`WebSocket\`, remote scripts, remote images and remote stylesheets are rejected. Put the data in the project: inline JSON attributes, a \`<script type="application/json" data-prop="...">\` child, or a \`.json\` file referenced with a \`<name>-src\` attribute.
- Do not add a \`<script>\` for the component runtime; the host injects it.
- Limits: ${CANVAS_LIMITS.maxFiles} files, ${CANVAS_LIMITS.maxTextFileBytes / 1024} KB per text file, ${CANVAS_LIMITS.maxTotalBytes / 1024 / 1024} MB in total.

## Components

- Build with \`<lobe-*>\` components (reference below). Plain \`h1\`–\`h4\`, \`p\`, \`ul\`, \`ol\`, \`a\`, \`blockquote\` and \`table\` are styled to match; use them for prose.
- Only the tags and attributes listed below exist. An unknown tag or attribute is rejected — never invent one.
- Write every component with a closing tag: \`<lobe-divider></lobe-divider>\`, never \`<lobe-divider />\`.
- Boolean attributes are written bare (\`<lobe-switch checked>\`). JSON attributes take single-quoted JSON: \`data='[{"a":1}]'\`.
- JSON props can come from a child \`<script type="application/json" data-prop="data">…</script>\` or from a project file: \`data-src="./data/cost.json"\`.
- Diagrams — flowcharts, sequences, state machines, architecture — are \`<lobe-mermaid>\` with Mermaid text. Do not draw them by hand with SVG.
- \`<lobe-code>\` and \`<lobe-mermaid>\` hold plain text: write \`<\` as \`&lt;\` and \`&\` as \`&amp;\`. A tag inside them is rejected.
- Colors follow the user's theme. Never hard-code colors on components (no \`style="color:#..."\`, no \`rgb()\`); use \`type\`, \`status\` or \`color\` attributes. Chart and tag colors are palette names: ${CANVAS_PALETTE.join(', ')}.

## Page layout

There is no fixed template. Shape the page around what this content needs: a comparison leads with the comparison, a plan with its timeline, a data analysis with its main chart.

- Say the answer early, in a heading or the first paragraph. \`<lobe-alert>\` is for a warning, a risk or a result the reader must not miss, not a default opener.
- \`<lobe-stat>\` is for a few headline numbers the reader will track or compare. Many pages have none; never make up counts ("3 candidates", "5 projects") to fill a grid. Set \`trend\` only when the number is compared with an earlier value or a target.
- Every chart and table backs a point stated in its heading. Prefer one clear chart over several similar ones.
- Close with what the reader should do and with the data's sources, time range and gaps, when they matter.
- Real numbers only; never placeholder data.

## Display rules

- \`<lobe-steps>\` \`status\` marks real progress. A list of recommendations or a sequence of actions has no status.
- Chart \`index\` and \`categories\` values are shown to the reader as axis and legend labels: write them as readable names in the user's language, not code keys.
- Do not style \`html\` or \`body\` (margin, padding, width, background); the host sets the page frame. Page CSS is for spacing inside your own layout.
- Keep tables to about five columns; transpose or split a wider one. Keep Mermaid diagrams small and prefer top-down (\`flowchart TD\`); the page is often a narrow side panel.

## Interactivity

Controls (\`lobe-select\`, \`lobe-segmented\`, \`lobe-switch\`, \`lobe-input\`, \`lobe-slider\`, \`lobe-button\`, …) fire a bubbling \`lobe-change\` event whose \`detail.value\` is the new value. Listen in plain JS and update the page, for example toggling \`hidden\` on sections or setting a chart's \`data\` attribute:

\`\`\`html
<lobe-segmented id="view" value="chart"><lobe-option value="chart">Chart</lobe-option><lobe-option value="table">Table</lobe-option></lobe-segmented>
<script>
  document.querySelector('#view').addEventListener('lobe-change', (event) => {
    document.querySelector('#chart').hidden = event.detail.value !== 'chart';
    document.querySelector('#table').hidden = event.detail.value !== 'table';
  });
</script>
\`\`\`

## Editing

- \`updateCanvas\` takes \`edits\` (exact \`oldText\` → \`newText\`, \`oldText\` must appear once), \`writes\` (whole files) and \`deletes\`. Prefer \`edits\` for small changes.
- Every successful save is a new version; the user sees the previous one until the new one validates.
- A rejected save lists each problem as \`file:line\`. Fix exactly those and save again.

# Component reference`;

export const buildCanvasGuide = () => `${rules}\n\n${buildCanvasComponentReference()}`;
