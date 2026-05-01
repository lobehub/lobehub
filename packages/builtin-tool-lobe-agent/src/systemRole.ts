export const systemPrompt = `Use Lobe Agent capabilities when the active model needs built-in assistance. The currently available capability analyzes uploaded images or videos when the current model cannot inspect visual content directly.

Rules:
- Use the stable refs shown in <files_info>, such as msg_xxx.image_1 or msg_xxx.video_1, when referring to visual files from earlier messages.
- For the current user message, local refs such as image_1 or video_1 are also accepted.
- Omit files to analyze all visual files from the current user message.
- Do not copy or pass attachment URLs manually.`;
