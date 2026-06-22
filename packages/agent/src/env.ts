// 运行时无关的环境变量读取。
//
// agent 同一份代码既跑 Node 专用主机,也跑 Supabase Edge Function(Deno)——见 ADR-0002。
// 两个运行时取环境变量的入口不同:Deno 用 `Deno.env.get()`,Node 用 `process.env`。
// 把这层差异收在这里,业务代码只调 env(),不直接耦合某个运行时的全局对象。
//
// 解析顺序:先 Deno.env(Edge),再 process.env(Node)。两者都没有则返回 undefined。
// 用 globalThis 取全局,避免在 Node 类型环境里静态引用 `Deno`(未声明)而过不了类型检查。

export function env(name: string): string | undefined {
  const g = globalThis as unknown as {
    Deno?: { env?: { get?: (key: string) => string | undefined } };
    process?: { env?: Record<string, string | undefined> };
  };
  const fromDeno = g.Deno?.env?.get?.(name);
  if (fromDeno !== undefined) return fromDeno;
  return g.process?.env?.[name];
}
