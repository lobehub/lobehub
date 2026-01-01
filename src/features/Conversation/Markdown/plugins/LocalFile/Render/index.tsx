import isEqual from 'fast-deep-equal';
import React, { memo } from 'react';

import { LocalFile } from '@/features/LocalFile';

import { type MarkdownElementProps } from '../../type';

interface LocalFileProps {
  isDirectory: boolean;
  name: string;
  path: string;
}

const Render = memo<MarkdownElementProps<LocalFileProps>>(({ node }) => {
  // 从 node.properties 中提取属性
  const { name, path, isDirectory } = node?.properties || {};

  if (!name || !path) {
    // 如果缺少必要属性，可以选择渲染错误提示或 null
    console.error('LocalFile Render component missing required properties:', node?.properties);
    return null; // 或者返回一个错误占位符
  }

  // isDirectory 属性可能为 true (来自插件) 或 undefined，我们需要确保它是 boolean
  const isDir = isDirectory === true;

  return <LocalFile isDirectory={isDir} name={name} path={path} />;
}, isEqual);

export default Render;
