import type { Screenplay } from './screenplay';

// 阶段不进剧本状态:由当前剧本派生(scenes > outline > characters > world > idea)。
export type Stage = 'idea' | 'world' | 'characters' | 'outline' | 'scenes';

export function deriveStage(s: Screenplay): Stage {
  if (s.scenes.length) return 'scenes';
  if (s.outline.length) return 'outline';
  if (s.characters.length) return 'characters';
  if (s.world.length) return 'world';
  return 'idea';
}

export const STAGE_LABELS: Record<Stage, string> = {
  idea: '灵感',
  world: '世界观',
  characters: '人物',
  outline: '大纲',
  scenes: '分场 · 对白',
};
