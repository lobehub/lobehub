import type { EditLocalFileParams } from '@lobechat/electron-client-ipc';

export const buildEditPreview = (
  content: string | undefined,
  args: Pick<EditLocalFileParams, 'old_string' | 'new_string' | 'replace_all'>,
) => {
  if (!content) return { matchCount: 0, newContent: '', oldContent: '' };

  const oldContent = content;
  const matchCount = args.old_string ? oldContent.split(args.old_string).length - 1 : 0;

  if (!args.replace_all && matchCount > 1) {
    return { matchCount, newContent: oldContent, oldContent };
  }

  const newContent = args.replace_all
    ? oldContent.replaceAll(args.old_string, () => args.new_string)
    : oldContent.replace(args.old_string, () => args.new_string);

  return { matchCount, newContent, oldContent };
};
