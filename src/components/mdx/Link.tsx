'use client';

import Link, { type LinkProps } from 'next/link';
import { type FC } from 'react';

const EXTERNAL_HREF_REGEX = /https?:\/\//;

const A: FC<LinkProps> = ({ href = '', ...props }) => {
  const isOutbound = EXTERNAL_HREF_REGEX.test(href as string);
  const isOfficial = String(href).includes('lobechat') || String(href).includes('lobehub');
  return (
    <Link
      href={href}
      rel={isOutbound && !isOfficial ? 'nofollow' : undefined}
      target={isOutbound ? '_blank' : undefined}
      {...props}
    />
  );
};

export default A;
