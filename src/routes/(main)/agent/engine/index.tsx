'use client';

import { AgentProfileView } from '../profile';

/** `/agent/:aid/engine` — what runs the agent: its driver, model and where it works. */
const AgentEnginePage = () => <AgentProfileView view="engine" />;

export default AgentEnginePage;
