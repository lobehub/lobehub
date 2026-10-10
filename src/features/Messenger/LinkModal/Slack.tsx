'use client';

import { memo } from 'react';

import OneClickBind from './OneClickBind';

interface SlackLinkBodyProps {
  /** Brand-name label (e.g. `"Slack"`) sourced from the registry. */
  name: string;
}

// The install consent screen also links the person who approves it, so one
// OAuth round trip leaves them connected — no follow-up DM to the bot.
const SlackLinkBody = memo<SlackLinkBodyProps>(({ name }) => (
  <OneClickBind name={name} platform="slack" />
));

SlackLinkBody.displayName = 'MessengerSlackLinkBody';

export default SlackLinkBody;
