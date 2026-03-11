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
  // Extract properties from node.properties
  const { name, path, isDirectory } = node?.properties || {};

  if (!name || !path) {
    // If required properties are missing, render an error or null
    console.error('LocalFile Render component missing required properties:', node?.properties);
    return null; // Or return an error placeholder
  }

  // isDirectory may be true (from plugin) or undefined; ensure it is a boolean
  const isDir = isDirectory === true;

  return <LocalFile isDirectory={isDir} name={name} path={path} />;
}, isEqual);

export default Render;
