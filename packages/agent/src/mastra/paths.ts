import { fileURLToPath } from 'node:url';

export const AGENT_PACKAGE_ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const AGENT_SKILLS_PATH = 'skills';
export const MASTRA_STUDIO_DB_PATH = fileURLToPath(new URL('../../.mastra-studio.db', import.meta.url));
export const MASTRA_STUDIO_OBSERVABILITY_DB_PATH = fileURLToPath(
  new URL('../../.mastra-studio.db.duckdb', import.meta.url),
);
export const SCREENWRITING_MASTER_SKILL_PATH = fileURLToPath(
  new URL('../../skills/screenwriting-master', import.meta.url),
);
