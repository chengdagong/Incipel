import { fileURLToPath } from 'node:url';

export const AGENT_PACKAGE_ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const AGENT_SKILLS_PATH = 'skills';
export const SCREENWRITING_MASTER_SKILL_PATH = fileURLToPath(
  new URL('../../skills/screenwriting-master', import.meta.url),
);
