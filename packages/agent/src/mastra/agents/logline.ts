import type { ModelRuntimeConfig } from '../../model/config.ts';
import { LOGLINE_INSTRUCTIONS } from '../../prompt.ts';
import { createAgent } from './factory.ts';

export function createLoglineAgent(config: ModelRuntimeConfig) {
  return createAgent('incipel-logline', 'Incipel Logline', config.logline, LOGLINE_INSTRUCTIONS);
}
