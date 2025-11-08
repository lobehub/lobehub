import { UIChatMessage } from '@lobechat/types';
import { template } from 'lodash-es';

import { LOADING_FLAT } from '@/const/message';
import { FieldType } from '@/features/ShareModal/ShareText/type';

const markdownTemplate = template(
  `# {{title}}

<% if (systemRole) { %>
\`\`\`\`md
{{systemRole}}
\`\`\`\`
<% } %>

<% messages.forEach(function(chat) { %>

<% if (withRole) { %>

<% if (chat.role === 'user') { %>
##### User:
<% } else if (chat.role === 'assistant') { %>
##### Assistant:
<% } else if (chat.role === 'tool') { %>
##### Tools Calling:
<% } %>

<% } %>

<% if (chat.role === 'tool') { %>
\`\`\`json
{{chat.content}}
\`\`\`
<% } else { %>

{{chat.content}}

<% if (includeTool && chat.tools) { %>

\`\`\`json
{{JSON.stringify(chat.tools, null, 2)}}
\`\`\`

<% } %>
<% } %>

<% }); %>
`,
  {
    evaluate: /<%([\S\s]+?)%>/g,
    interpolate: /{{([\S\s]+?)}}/g,
  },
);

interface MarkdownParams extends FieldType {
  messages: UIChatMessage[];
  systemRole: string;
  title: string;
}

export const generateMarkdown = ({
  messages,
  title,
  includeTool,
  includeUser,
  withSystemRole,
  withRole,
  systemRole,
}: MarkdownParams) =>
  markdownTemplate({
    includeTool,
    messages: messages
      .filter((m) => m.content !== LOADING_FLAT)
      .filter((m) => (!includeUser ? m.role !== 'user' : true))
      .filter((m) => (!includeTool ? m.role !== 'tool' : true)),
    systemRole: withSystemRole ? systemRole : undefined,
    title,
    withRole,
  });
