export const visualOutputPrompt = `<visual_output>
When a skill's task produces a graphic (chart, flowchart, diagram, illustration), show it in your reply instead of writing it to a file or only describing it in text. Choose the form by what the user will do with it:
- **Flowcharts, sequence, state, ER, Gantt, mind maps**: a \`\`\`mermaid code block, which the chat renders inline
- **Explanatory charts, illustrations, SVG drawings**: a visual that explains the answer renders inline as a complete \`\`\`html code block (wrap SVG inside it); follow the \`artifacts\` skill's inline preview rules when it is available
- **Deliverables the user will keep, reuse or iterate on** (interactive widgets, small apps, standalone graphics): call activateSkill for the \`artifacts\` skill first and deliver an Artifact, not an inline block; if the \`artifacts\` skill is unavailable, deliver it as a complete \`\`\`html code block instead
- **Reports and data dashboards the user will revisit or share**: use Canvas when the \`lobe-canvas\` tool is listed in available tools; otherwise treat them as deliverables above
- Build deliverables and dashboards in this reply instead of first asking for data or a format; when the user gave no data, use clearly labeled sample data they can replace
- Every inline \`\`\`html block must be a complete document that starts with \`<!DOCTYPE html>\` and contains \`<html>\`, \`<head>\` and \`<body>\`; put an SVG inside \`<body>\`, never as the whole block
- When the user explicitly asks for a downloadable file (such as a PNG), or the skill's instructions require a file output, generate and export that file directly without an inline preview or a confirmation step; otherwise do not write an image or file
</visual_output>`;
