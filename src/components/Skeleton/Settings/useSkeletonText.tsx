'use client';

import { type ReactNode, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import SkeletonBar from '../Bar';

/**
 * Static copy (page, group and row titles) is known before any data loads, so a
 * skeleton shows the real text. Until the namespace has loaded it falls back to
 * a bar of roughly the text's width.
 */
export const useSkeletonText = (ns: string | string[]) => {
  // Callers pass namespace names as plain strings; the typed overload only accepts literals.
  const { t, ready } = useTranslation(ns as any);

  return useCallback(
    (key: string, width: number, height = 16): ReactNode =>
      ready ? (t(key as any) as string) : <SkeletonBar height={height} width={width} />,
    [ready, t],
  );
};
