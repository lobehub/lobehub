import { memo } from 'react';

import { TypoBar as EditorTypoBar } from '@/features/EditorCanvas/TypoBar';

import { useChatInputStore } from '../store';

const TypoBar = memo(() => {
  const editor = useChatInputStore((s) => s.editor);

  return <EditorTypoBar editor={editor} />;
});

TypoBar.displayName = 'TypoBar';

export default TypoBar;
