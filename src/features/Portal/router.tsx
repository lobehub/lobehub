'use client';

import React, { Fragment, memo } from 'react';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';

import { Artifacts } from './Artifacts';
import Header from './components/Header';
import { Document } from './Document';
import { FilePreview } from './FilePreview';
import { GroupThread } from './GroupThread';
import { HomeBody, HomeTitle } from './Home';
import { MessageDetail } from './MessageDetail';
import { Notebook } from './Notebook';
import { Plugins } from './Plugins';
import { Thread } from './Thread';
import { type PortalImpl } from './type';

// View type to component mapping
const VIEW_COMPONENTS: Record<PortalViewType, PortalImpl> = {
  [PortalViewType.Home]: {
    Body: HomeBody,
    Title: HomeTitle,
  },
  [PortalViewType.Artifact]: Artifacts,
  [PortalViewType.Document]: Document,
  [PortalViewType.Notebook]: Notebook,
  [PortalViewType.FilePreview]: FilePreview,
  [PortalViewType.MessageDetail]: MessageDetail,
  [PortalViewType.ToolUI]: Plugins,
  [PortalViewType.Thread]: Thread,
  [PortalViewType.GroupThread]: GroupThread,
};

// Default Home component
const HomeImpl: PortalImpl = {
  Body: HomeBody,
  Title: HomeTitle,
};

interface PortalContentProps {
  renderBody?: (body: React.ReactNode) => React.ReactNode;
}

/**
 * Portal content with Wrapper support
 * Uses the view stack to determine which component to render
 */
export const PortalContent = memo<PortalContentProps>(({ renderBody }) => {
  const viewType = useChatStore(chatPortalSelectors.currentViewType);
  const ViewImpl = viewType ? VIEW_COMPONENTS[viewType] : HomeImpl;

  const Wrapper = ViewImpl?.Wrapper || Fragment;
  const CustomHeader = ViewImpl?.Header;
  const Body = ViewImpl?.Body || HomeBody;
  const Title = ViewImpl?.Title || HomeTitle;

  const headerContent = CustomHeader ? <CustomHeader /> : <Header title={<Title />} />;
  const bodyContent = <Body />;

  return (
    <Wrapper>
      {headerContent}
      {renderBody ? renderBody(bodyContent) : bodyContent}
    </Wrapper>
  );
});
