'use client';

import React, { Fragment, memo } from 'react';

import { Artifacts } from './Artifacts';
import { Document } from './Document';
import { FilePreview } from './FilePreview';
import { GroupThread } from './GroupThread';
import { HomeBody, HomeTitle } from './Home';
import { MessageDetail } from './MessageDetail';
import { Notebook } from './Notebook';
import { Plugins } from './Plugins';
import { Thread } from './Thread';
import Header from './components/Header';
import { type PortalImpl } from './type';

// Keep GroupThread before Thread so group DM threads take precedence when enabled
// Document should be before Notebook so detail view takes precedence
const items: PortalImpl[] = [
  GroupThread,
  Thread,
  MessageDetail,
  Artifacts,
  Plugins,
  FilePreview,
  Document,
  Notebook,
];

export const PortalTitle = memo(() => {
  const enabledList: boolean[] = [];

  for (const item of items) {
    const enabled = item.useEnable();
    enabledList.push(enabled);
  }

  for (const [i, element] of enabledList.entries()) {
    const Title = items[i].Title;
    if (element) {
      return <Title />;
    }
  }

  return <HomeTitle />;
});

export const PortalHeader = memo(() => {
  const enabledList: boolean[] = [];

  for (const item of items) {
    const enabled = item.useEnable();
    enabledList.push(enabled);
  }

  for (const [i, element] of enabledList.entries()) {
    const Header = items[i].Header;
    if (element && Header) {
      return <Header />;
    }
  }

  return <Header title={<PortalTitle />} />;
});

const PortalBody = memo(() => {
  const enabledList: boolean[] = [];

  for (const item of items) {
    const enabled = item.useEnable();
    enabledList.push(enabled);
  }

  for (const [i, element] of enabledList.entries()) {
    const Body = items[i].Body;
    if (element) {
      return <Body />;
    }
  }

  return <HomeBody />;
});

interface PortalContentProps {
  renderBody?: (body: React.ReactNode) => React.ReactNode;
}

/**
 * Portal content with Wrapper support
 * When an enabled item has a Wrapper, it wraps both Header and Body
 */
const PortalContent = memo<PortalContentProps>(({ renderBody }) => {
  const enabledList: boolean[] = [];

  for (const item of items) {
    const enabled = item.useEnable();
    enabledList.push(enabled);
  }

  // Find the first enabled item
  let enabledIndex = -1;
  for (const [i, element] of enabledList.entries()) {
    if (element) {
      enabledIndex = i;
      break;
    }
  }

  // Get components for the enabled item
  const enabledItem = enabledIndex >= 0 ? items[enabledIndex] : null;
  const Wrapper = enabledItem?.Wrapper || Fragment;
  const CustomHeader = enabledItem?.Header;
  const Body = enabledItem?.Body || HomeBody;

  const headerContent = CustomHeader ? (
    <CustomHeader />
  ) : (
    <Header title={enabledItem?.Title ? <enabledItem.Title /> : <HomeTitle />} />
  );

  const bodyContent = <Body />;

  return (
    <Wrapper>
      {headerContent}
      {renderBody ? renderBody(bodyContent) : bodyContent}
    </Wrapper>
  );
});

export { PortalContent };
export default PortalBody;
