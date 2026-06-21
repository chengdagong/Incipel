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

// 默认主色 #C2724E(亮陶土)白字 CTA 仅 ~3.6:1、作小字链接仅 ~3.2:1,均不达 WCAG AA;
// 压深一档到 #A8552E:白字 ~5.2:1、奶底上作文字 ~4.7:1,两项都过 AA,色相仍是同族陶土。
// 其余三色为备选(主题切换 UI 暂未上),作白字 CTA 大多已达标;待色板选择器上线时一并复核。
export const ACCENT_OPTIONS = ['#A8552E', '#5B7B6F', '#6B7280', '#8A6FA8'] as const;
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

// 把(可能为旧结构持久化的)剧本归一到当前形态。documents.state 是 opaque jsonb,
// 人物从单段 `note` 升级为结构化 `role + attrs[]` 后,载入改动前落库的行时人物可能缺 attrs/role;
// 在载入边界归一(补 attrs=[]、把旧 note 搬进 role),避免下游(idSetsOf / serializeScreenplay /
// 客户端卡片)对 undefined 取属性而崩。各实体数组也一并兜空,容忍残缺历史数据。
export function normalizeScreenplay(s: Screenplay): Screenplay {
  return {
    ...s,
    world: s.world ?? [],
    outline: s.outline ?? [],
    scenes: s.scenes ?? [],
    characters: (s.characters ?? []).map((c) => {
      const legacy = c as Partial<Character> & { note?: unknown };
      return {
        id: legacy.id ?? '',
        name: legacy.name ?? '',
        role: legacy.role ?? (typeof legacy.note === 'string' ? legacy.note : ''),
        attrs: Array.isArray(legacy.attrs) ? legacy.attrs : [],
      };
    }),
  };
}
