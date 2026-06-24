// charView 派生:身份徽标只认标准类别,被误塞进「身份」的小传应落到正文,不撑成 header 徽标。
import { describe, expect, it } from 'vitest';
import type { Character, CharacterAttr } from '@incipel/shared';
import { charView } from './charView';

let n = 0;
const a = (label: string, value: string): CharacterAttr => ({ id: `a${n++}`, label, value });
const char = (attrs: CharacterAttr[], role = ''): Character => ({ id: 'c1', name: '林屿', role, attrs });

describe('charView', () => {
  it('标准身份类别 → 徽标,背景 → 小传', () => {
    const v = charView(char([a('身份', '主角'), a('年龄', '25 岁'), a('性别', '男'), a('背景', '一线城市普通青年'), a('性格', '克制')]));
    expect(v.identity).toBe('主角');
    expect(v.ageGender).toBe('25 岁 · 男');
    expect(v.bio).toBe('一线城市普通青年');
    expect(v.tags.map((t) => t.label)).toEqual(['性格']);
  });

  it('被误塞进「身份」的整段小传 → 不作徽标,落到小传(正文)', () => {
    const intro = '25岁,一线城市普通青年,曾在一家互联网公司做人力/运营,因裁员失业;独居在租来的老旧公寓里。';
    const v = charView(char([a('身份', intro), a('性格', '内向'), a('现状', '失业'), a('目标', '重新振作'), a('外貌', '清瘦')], '现实世界的青年主角'));
    expect(v.identity).toBe(''); // 不渲染巨型徽标
    expect(v.bio).toBe(intro); // 进正文小传
    // 「身份」始终不进标签 chip,避免与小传重复。
    expect(v.tags.map((t) => t.label)).toEqual(['性格', '现状', '目标', '外貌']);
  });

  it('既有标准身份又有背景时,徽标取身份,小传取背景', () => {
    const v = charView(char([a('身份', '配角'), a('背景', '游戏里的 AI 居民')]));
    expect(v.identity).toBe('配角');
    expect(v.bio).toBe('游戏里的 AI 居民');
  });

  it('非标准身份(反派)+ 背景:身份不当徽标也不丢,退为标签保留', () => {
    const v = charView(char([a('身份', '反派'), a('背景', '某段往事'), a('性格', '阴鸷')]));
    expect(v.identity).toBe(''); // 反派非标准类别,不作徽标
    expect(v.bio).toBe('某段往事'); // 小传取背景
    // 关键:反派值不消失——以「身份」标签保留,值仍可在文档详情点开看到。
    const idTag = v.tags.find((t) => t.label === '身份');
    expect(idTag?.value).toBe('反派');
    expect(v.tags.map((t) => t.label)).toEqual(['身份', '性格']);
  });

  it('身份缺失时徽标为空,小传仍取背景', () => {
    const v = charView(char([a('背景', '某段往事'), a('外貌', '戴墨镜')]));
    expect(v.identity).toBe('');
    expect(v.bio).toBe('某段往事');
    expect(v.tags.map((t) => t.label)).toEqual(['外貌']);
  });
});
