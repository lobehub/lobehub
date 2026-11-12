'use client';

import { AgentProfileView } from '../profile';

/** `/agent/:aid/knowledge` — the knowledge bases and files the agent can search. */
const AgentKnowledgePage = () => <AgentProfileView view="knowledge" />;

export default AgentKnowledgePage;
