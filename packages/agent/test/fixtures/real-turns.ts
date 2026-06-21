// 录制的「真实一轮」fixture(贴近真实模型那种更乱的产出),经 stub 确定性回放。见 ADR-0007(Q2)(C)。
//
// 目的:压 apply / save 这条数据契约——客户端渲染就靠它——在真实模型常见的「乱」面前不崩、不丢内容:
//   超长文本、一轮多人物、空字段、奇怪 unicode(emoji / 组合附加符 / 零宽连接 / RTL / 全角)、一轮覆盖全实体。
//
// 这些是 StreamChunk 脚本(经 test/helpers/stubProvider 回放),内容刻意贴近真实产出而非整洁示例。
// 范围:本仓暂无 RN 组件测试 harness,故覆盖到「喂给客户端的剧本状态形状正确、内容无损」为止;
// 真正的客户端 UI 渲染(InlineCard / 文档面板)测试待 RN 测试 harness 搭好后再补(见 issue #33)。

import type { StreamChunk } from '../../src/model/provider';

const text = (delta: string): StreamChunk => ({ type: 'text', delta });
const tool = (toolCallId: string, toolName: string, args: unknown): StreamChunk => ({
  type: 'tool-call',
  call: { toolCallId, toolName, args },
});

export type TurnFixture = {
  name: string;
  note: string;
  userMessage: string;
  script: StreamChunk[];
  // 必须原样幸存进最终剧本(JSON.stringify(state) 里能找到)的内容探针。
  probes: string[];
};

// 一段超长助手文本(~1.1k 字):真实模型「接管」时常一口气写很长,验证不被截断。
const LONG_TEXT = '她站在月台尽头,看最后一班列车的尾灯把隧道染成一条退色的红线。'.repeat(40);

export const TURN_FIXTURES: TurnFixture[] = [
  {
    name: 'long-text-multi-character',
    note: '超长助手文本 + 一轮建三个人物(多人物卡)',
    userMessage: '把这个群像戏的开头铺开,先立三个核心人物。',
    script: [
      text('我把这个群像的底色先铺一层——'),
      text(LONG_TEXT),
      tool('f1-meta', 'set_meta', {
        title: '霓虹尽头',
        logline: '三个被同一桩旧案改写人生的人,在十年后同一夜重逢。',
      }),
      tool('f1-c1', 'add_character', {
        name: '沈砚',
        role: '退役刑警',
        attrs: [
          { label: '外貌', value: '左眉一道旧疤' },
          { label: '执念', value: '十年前那桩没破的案子' },
        ],
      }),
      tool('f1-c2', 'add_character', {
        name: '林晚',
        role: '夜班护士',
        attrs: [{ label: '秘密', value: '当晚她也在现场' }],
      }),
      tool('f1-c3', 'add_character', { name: '老周', role: '出租车司机', attrs: [] }),
      tool('f1-opt', 'propose_options', {
        options: ['先挖沈砚与旧案', '让林晚先开口', '从老周那晚的行车记录切入'],
      }),
    ],
    probes: ['霓虹尽头', '沈砚', '林晚', '老周', '左眉一道旧疤'],
  },
  {
    name: 'weird-unicode',
    note: 'emoji / 组合附加符 / 零宽连接 / RTL / 全角 —— 不该丢字符或乱码',
    userMessage: '风格再野一点,名字也别太规矩。',
    script: [
      text('🎬 风格我给你拉满 —— café 霓虹 + 雾都。'),
      tool('f2-meta', 'set_meta', {
        title: '🎬 Café Renée — مدينة الضباب · 雾都',
        logline: 'é vs é(组合附加符);全角标点:！？《》',
      }),
      tool('f2-c1', 'add_character', {
        name: 'Renée‍🎭',
        role: '演员／侦探 👤',
        attrs: [{ label: '外貌', value: '👩‍🦰 红发,👨‍👩‍👧 家庭照不离身' }],
      }),
      tool('f2-opt', 'propose_options', { options: ['跟 Renée 走', 'مدينة الضباب 那条线'] }),
    ],
    probes: ['🎬 Café Renée — مدينة الضباب · 雾都', 'Renée‍🎭', '👩‍🦰', '👨‍👩‍👧'],
  },
  {
    name: 'empty-and-sparse',
    note: '空字段(空 role / 空 attr value / 空 world text / 空 scene content)—— 不该崩,空串照存',
    userMessage: '先占个位,细节我后面补。',
    script: [
      text('占位先搭好,细节你随时补。'),
      tool('f3-c1', 'add_character', { name: '无名者', role: '', attrs: [{ label: '状态', value: '' }] }),
      tool('f3-w1', 'add_world_section', { title: '空白设定', text: '' }),
      tool('f3-s1', 'add_scene', { slug: '内景 地铁 — 夜', content: '' }),
    ],
    probes: ['无名者', '空白设定', '内景 地铁 — 夜'],
  },
  {
    name: 'full-screenplay',
    note: '一轮覆盖全实体:meta + 世界观 + 人物 + 两幕 + 两场 + 选项',
    userMessage: '直接接管,把骨架一次搭全。',
    script: [
      text('这次我直接接管,把骨架一次给你搭全。'),
      tool('f4-meta', 'set_meta', {
        title: '雾港',
        logline: '一个失忆的引航员,要在三天内找回沉船那夜的记忆。',
      }),
      tool('f4-w1', 'add_world_section', {
        title: '雾港',
        text: '常年被咸雾笼罩的北方港城,灯塔是唯一的坐标。',
      }),
      tool('f4-c1', 'add_character', {
        name: '陆鸣',
        role: '引航员',
        attrs: [{ label: '困境', value: '沉船那夜后失忆' }],
      }),
      tool('f4-a1', 'add_act', { act: '第一幕', beat: '陆鸣在医院醒来,发现自己是唯一幸存者。' }),
      tool('f4-a2', 'add_act', { act: '第二幕', beat: '循着航海日志的残页,他重走那条致命航线。' }),
      tool('f4-s1', 'add_scene', {
        slug: '内景 港务医院 — 晨',
        content: '陆鸣（虚弱）:那条船……还有别人吗?',
      }),
      tool('f4-s2', 'add_scene', { slug: '外景 灯塔 — 夜', content: '海风灌进塔顶。陆鸣盯着那盏明灭的灯。' }),
      tool('f4-opt', 'propose_options', { options: ['先查航海日志', '去见沉船幸存者家属'] }),
    ],
    probes: ['雾港', '陆鸣', '第一幕', '第二幕', '内景 港务医院 — 晨', '外景 灯塔 — 夜'],
  },
];
