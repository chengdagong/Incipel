// 剧本(Screenplay):对话沉淀出的结构化产物。agent 与客户端同步的唯一权威对象。
// 每个实体都有稳定 id,由服务端生成(模型无权自造)——见 docs/adr/0001。

export type WorldSection = { id: string; title: string; text: string };
// 人物属性:一条带 id 的 label/value(如 外貌 / 性格 / 身份),id 由服务端生成。
// 结构化属性支持「点某条属性深聊」(聚焦标签)与「由外貌+性格拼肖像提示词」(见 ADR-0001 扩展段)。
export type CharacterAttr = { id: string; label: string; value: string };
// 人物:名字 + 一句话定位(role)+ 若干带 id 的属性。取代早期的单段 note。
export type Character = { id: string; name: string; role: string; attrs: CharacterAttr[] };
export type Act = { id: string; act: string; beat: string };
export type Scene = { id: string; slug: string; content: string };

export type ScreenplayMeta = {
  title: string;
  logline: string;
  accent: string; // 主色
  updatedAt: string; // ISO 时间
};

export type Screenplay = {
  meta: ScreenplayMeta;
  world: WorldSection[]; // 世界观:若干带 id 的小节(标题任意)
  characters: Character[];
  outline: Act[];
  scenes: Scene[]; // 扁平,不挂在某一幕下
};

export const ACCENT_OPTIONS = ['#C2724E', '#5B7B6F', '#6B7280', '#8A6FA8'] as const;
export type Accent = (typeof ACCENT_OPTIONS)[number];

export function emptyScreenplay(accent: string = ACCENT_OPTIONS[0]): Screenplay {
  return {
    meta: { title: '', logline: '', accent, updatedAt: new Date().toISOString() },
    world: [],
    characters: [],
    outline: [],
    scenes: [],
  };
}
