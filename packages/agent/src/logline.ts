// POST /logline:欢迎页点 🎲 时,用便宜小模型一次性生成一句符合经典结构的 logline
//(反差身份主角 + 触发事件 + 具体目标 + 明确阻力,25–50 字)。
// 走独立端点而非 run 编排:不碰剧本、不落库,纯一次性 completion(见 system-design §9、§10)。

import { createModelProvider } from './model/provider.ts';
import { buildLoglinePrompt } from './prompt.ts';

export type LoglineInput = {
  // 兼容旧客户端字段;生成时不会参考它。
  idea?: string;
};

export type LoglineResult = {
  logline: string;
};

// TODO(限流): 单用户限流。骰子可被反复点,每点一次都打模型。
// 上线前在此(或入口中间件)加单用户速率限制——例如以 user_id 为键的滑动窗口计数。

export async function generateLogline(input: LoglineInput): Promise<LoglineResult> {
  void input;
  const provider = await createModelProvider();
  const { system, prompt } = buildLoglinePrompt();
  const logline = await provider.completeLogline({ system, prompt, temperature: 1.1 });
  return { logline: logline.trim() };
}
