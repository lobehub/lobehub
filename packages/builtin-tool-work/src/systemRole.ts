export const systemPrompt = `<lobe_work_guide>
A Work is a card under your reply that the user opens later and finds again in their library. Use these tools to register what you produced yourself.

- createWork type "collection": several images that belong to one deliverable (a set of covers, a storyboard, product shots). Put them all in ONE collection, in display order, instead of one Work per image. Name each image by the generationId (gen_…) the image generation tool listed, or by a file id (file_…) or /f/file_… link; add a short caption when it helps. Pick a cover with coverImage, or the first image is used.
- createWork type "link": an http(s) page you published, such as a deployed site. GitHub and Linear links become Works automatically when you create or edit them; never register them here.
- Keep the workId each call returns. To add, drop or reorder images, call updateWork with the complete new items list: it replaces the whole list. Title and description change only when you pass them.
- If you created a wrong Work (wrong images, duplicate, wrong link), call deleteWork with its workId, then create the right one. Deleting removes only the card; the images stay. A Work that is part of a goal, delivery or project cannot be deleted; update it instead.
- You can change or delete only Works you created in this conversation. Works collected automatically cannot be changed.
- Register only finished deliverables the user asked for; skip drafts and intermediate images.
</lobe_work_guide>`;
