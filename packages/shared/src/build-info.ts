import { AGENTDECK_VERSION } from './version.js';

export interface AgentDeckBuildInfo {
  version: string;
  buildId: string;
  builtAt: string;
  environment: 'production' | 'development';
}

export const AGENTDECK_BUILD_INFO: AgentDeckBuildInfo = {
  version: AGENTDECK_VERSION,
  buildId: `build-v${AGENTDECK_VERSION}-local`,
  builtAt: '2026-08-21T00:00:00.000Z',
  environment: 'production',
};
