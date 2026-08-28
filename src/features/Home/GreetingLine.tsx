import { createStaticStyles } from 'antd-style';
import { memo, type MouseEvent, type ReactNode } from 'react';

import { useStableNavigate } from '@/hooks/useStableNavigate';

import { classifyGreetingHref } from './greetingLink';
import { type GreetingLink, type ParsedGreeting } from './welcomeText';

// "Highlighter underline": a linear gradient paints a thin tinted bar along the
// bottom of each character box instead of `text-decoration: underline`, which
// at heading weight would read as a heavy rule.
const styles = createStaticStyles(({ css, cssVar }) => ({
  link: css`
    padding-block-end: 1px;
    color: ${cssVar.colorText};
    text-decoration: none;
    background: linear-gradient(to top, ${cssVar.colorPrimaryBgHover} 30%, transparent 30%);
  `,
}));

/** Relative hrefs navigate in-app; external ones open a tab. */
const BriefLink = memo<{ children: ReactNode; href: string }>(({ href, children }) => {
  const navigate = useStableNavigate();
  const hrefKind = classifyGreetingHref(href);

  if (hrefKind === 'unsafe') return <>{children}</>;

  if (hrefKind === 'external')
    return (
      <a className={styles.link} href={href} rel="noopener noreferrer" target="_blank">
        {children}
      </a>
    );

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // Honour modifier-clicks so "open in new tab" still works.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
      return;
    event.preventDefault();
    navigate(href);
  };

  return (
    <a className={styles.link} href={href} onClick={onClick}>
      {children}
    </a>
  );
});

const renderSpans = (plain: string, links: GreetingLink[]): ReactNode[] => {
  if (links.length === 0) return [plain];

  const out: ReactNode[] = [];
  let cursor = 0;
  for (const [index, link] of links.entries()) {
    if (link.start > cursor) out.push(plain.slice(cursor, link.start));
    out.push(
      <BriefLink href={link.href} key={`${link.start}-${index}`}>
        {link.text}
      </BriefLink>,
    );
    cursor = link.end;
  }
  if (cursor < plain.length) out.push(plain.slice(cursor));

  return out;
};

/** The generated half of the greeting, with its entity references left clickable. */
const GreetingLine = memo<{ parsed: ParsedGreeting }>(({ parsed }) => (
  <>{renderSpans(parsed.plain, parsed.links)}</>
));

export default GreetingLine;
