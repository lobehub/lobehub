'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import EditorCanvas from './EditorCanvas';
import TodoList from './TodoList';

const styles = createStaticStyles(({ css }) => ({
  content: css`
    overflow: auto;
    flex: 1;
    padding-inline: 16px;
  `,
  todoContainer: css`
    flex-shrink: 0;
    padding-block-end: 12px;
    padding-inline: 12px;
  `,
}));

const DocumentBody = memo(() => {
  return (
    <Flexbox flex={1} height={'100%'} style={{ overflow: 'hidden' }}>
      <div className={styles.content}>
        <EditorCanvas />
      </div>
      <div className={styles.todoContainer}>
        <TodoList />
      </div>
    </Flexbox>
  );
});

export default DocumentBody;
