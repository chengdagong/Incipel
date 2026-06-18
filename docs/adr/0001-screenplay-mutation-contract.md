# 模型修改剧本的契约:显式 add/update/remove + 服务端生成 id + 枚举门控

「织幕」对剧本的所有改动都经由模型的 tool use 完成,契约固定为:每类实体(世界观小节、人物、幕、分场)都有显式的 `add` / `update` / `remove` 工具——新建用 `add`(不带 id),修改用 `update`(必须带 id)。id 一律由服务端生成,模型无权自造;`update` / `remove` 的 `id` 参数在工具 schema 里被约束为「当前剧本中真实存在的那组 id」的枚举,每轮按当前状态重新生成,模型在生成时就吐不出不存在的 id;服务端再校验一次,id 不合法即拒绝、绝不静默新建。世界观也据此从一段文本改成带 id 的小节(标题任意),不再整段覆盖。

之所以不用更省事的「upsert(可选 id,无 id 即新建)」或「让模型输出 JSON / 文本再解析」:原型反复栽在后者——模型在 JSON 字符串里输出字面换行、引号就撑坏解析,长内容尤甚;按 name 匹配又会在改名 / 改字时丢失实体身份、冒出重复人物。显式 + 门控的契约从结构上消灭了「解析失败」和「错误 / 重复 id」这两类 bug。

## Consequences

- v1 只接 tool-use 可靠的模型,**不**保留任何文本解析降级路径,也不为弱 provider 做让步;模型抽象层只在 tool-use 可靠的 provider 之间切换。
- 工具数量较多(每类实体三个),且 `update` / `remove` 的 schema 需按轮动态生成(注入当前 id 枚举)。这是为正确性付的代价——**不要**为「简化」退回 upsert 或世界观整段覆盖,那会把上面两类 bug 放回来。

## 扩展:人物结构化属性(2026-06-18)

人物从单段 `note` 升级为 **名字 + 一句话定位(role)+ 若干带 id 的属性**(`attrs: { id, label, value }[]`,如 外貌/性格/身份)。动因:UI 要支持「点某条属性回对话深聊」(聚焦标签)与「由 外貌+性格 拼肖像提示词」,单段 `note` 无处可点、也拆不出字段。

属性沿用本 ADR 的同一套契约,不开新例外:

- `add_character({ name, role? })` / `update_character({ id, name?, role? })` / `remove_character({ id })` 只管名字与定位。
- 属性单列三个显式工具:`add_character_attr({ characterId, label, value })`、`update_character_attr({ attrId, label?, value? })`、`remove_character_attr({ attrId })`。
- `attrId` **全局唯一**(跨人物),`update/remove_character_attr` 的 `attrId` 与 `add_character_attr` 的 `characterId` 都在 schema 里按当前状态枚举锁死;服务端 `apply` 再校验一次,不存在即拒绝、绝不静默新建。
- 剧本存在 `documents.state` 的 jsonb 里,**不需要 SQL(DDL)migration**;但 jsonb 是 opaque、不做归一,**改动前落库的旧行**里人物只有 `note`、缺 `attrs`/`role`,直接喂给 `idSetsOf` / `serializeScreenplay` 会对 `undefined` 取属性而崩。因此在**载入边界**用 `normalizeScreenplay`(`@incipel/shared`)补齐(`attrs` 兜空、旧 `note` 搬进 `role`),`store.loadSession` 已接入——这是数据归一,不是 schema migration。

**不要**把属性塞回一段长 `note`,或用「整组覆盖 attrs」的 upsert——那会重新引入「partial 编辑丢内容」与「错误/重复 id」。
