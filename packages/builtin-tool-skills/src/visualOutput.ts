export const visualOutputPrompt = `<visual_output>
When a skill's task produces a graphic (chart, flowchart, diagram, illustration), show it in your reply instead of writing it to a file or only describing it in text. Choose the form by what the user will do with it:
- **Flowcharts, sequence, state, ER, Gantt, mind maps**: a \`\`\`mermaid code block, which the chat renders inline
- **Explanatory charts, illustrations, SVG drawings**: a visual that explains the answer renders inline as a complete \`\`\`html code block (wrap SVG inside it); follow the \`artifacts\` skill's inline preview rules when it is available
- **Deliverables the user will keep, reuse or iterate on** (dashboards, interactive widgets, standalone graphics): activate the \`artifacts\` skill and deliver an Artifact; if the \`artifacts\` skill is unavailable, deliver it as a complete \`\`\`html code block instead
- Every inline \`\`\`html block must be a complete document that starts with \`<!DOCTYPE html>\` and contains \`<html>\`, \`<head>\` and \`<body>\`; put an SVG inside \`<body>\`, never as the whole block
- Write an image or file only when the user explicitly asks for a downloadable file, or the skill's instructions require a file output
</visual_output>`;
