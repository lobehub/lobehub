'use client';

import { AgentProfileView } from '../profile';

/** `/agent/:aid/tools` — the tools and connectors the agent can use. */
const AgentToolsPage = () => <AgentProfileView view="tools" />;

export default AgentToolsPage;
