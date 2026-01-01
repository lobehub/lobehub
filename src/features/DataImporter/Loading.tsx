'use client';

import { Center } from '@lobehub/ui';
import { createStaticStyles, keyframes } from 'antd-style';
import React, { memo } from 'react';

const size = 28;

const loading = keyframes`
  12.5% {
    box-shadow:
      ${size}px -${size}px 0 0,
      ${size * 2}px -${size}px 0 0,
      ${size * 3}px -${size}px 0 5px,
      ${size}px 0 0 5px,
      ${size * 2}px 0 0 0,
      ${size * 3}px 0 0 5px,
      ${size}px ${size}px 0 0,
      ${size * 2}px ${size}px 0 0,
      ${size * 3}px ${size}px 0 0;
  }

  25% {
    box-shadow:
      ${size}px -${size}px 0 5px,
      ${size * 2}px -${size}px 0 0,
      ${size * 3}px -${size}px 0 5px,
      ${size}px 0 0 0,
      ${size * 2}px 0 0 0,
      ${size * 3}px 0 0 0,
      ${size}px ${size}px 0 0,
      ${size * 2}px ${size}px 0 5px,
      ${size * 3}px ${size}px 0 0;
  }

  50% {
    box-shadow:
      ${size}px -${size}px 0 5px,
      ${size * 2}px -${size}px 0 5px,
      ${size * 3}px -${size}px 0 0,
      ${size}px 0 0 0,
      ${size * 2}px 0 0 0,
      ${size * 3}px 0 0 0,
      ${size}px ${size}px 0 0,
      ${size * 2}px ${size}px 0 0,
      ${size * 3}px ${size}px 0 5px;
  }

  62.5% {
    box-shadow:
      ${size}px -${size}px 0 0,
      ${size * 2}px -${size}px 0 0,
      ${size * 3}px -${size}px 0 0,
      ${size}px 0 0 5px,
      ${size * 2}px 0 0 0,
      ${size * 3}px 0 0 0,
      ${size}px ${size}px 0 0,
      ${size * 2}px ${size}px 0 5px,
      ${size * 3}px ${size}px 0 5px;
  }

  75% {
    box-shadow:
      ${size}px -${size}px 0 0,
      ${size * 2}px -${size}px 0 5px,
      ${size * 3}px -${size}px 0 0,
      ${size}px 0 0 0,
      ${size * 2}px 0 0 0,
      ${size * 3}px 0 0 5px,
      ${size}px ${size}px 0 0,
      ${size * 2}px ${size}px 0 0,
      ${size * 3}px ${size}px 0 5px;
  }

  87.5% {
    box-shadow:
      ${size}px -${size}px 0 0,
      ${size * 2}px -${size}px 0 5px,
      ${size * 3}px -${size}px 0 0,
      ${size}px 0 0 0,
      ${size * 2}px 0 0 5px,
      ${size * 3}px 0 0 0,
      ${size}px ${size}px 0 5px,
      ${size * 2}px ${size}px 0 0,
      ${size * 3}px ${size}px 0 0;
  }
`;

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    loader: css`
      transform: translateX(-${size * 2}px);

      aspect-ratio: 1;
      width: 6px;
      border-radius: 50%;

      color: ${cssVar.colorPrimary};

      box-shadow:
        ${size}px -${size}px 0 0,
        ${size * 2}px -${size}px 0 0,
        ${size * 3}px -${size}px 0 0,
        ${size}px 0 0 5px,
        ${size * 2}px 0 0 5px,
        ${size * 3}px 0 0 5px,
        ${size}px ${size}px 0 0,
        ${size * 2}px ${size}px 0 0,
        ${size * 3}px ${size}px 0 0;

      animation: ${loading} 2s infinite linear;
    `,
  };
});

const DataLoading = memo(() => {
  return (
    <Center style={{ height: 80 }}>
      <div className={styles.loader} />
    </Center>
  );
});

export default DataLoading;
