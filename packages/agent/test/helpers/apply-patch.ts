// 最小 RFC 6902 JSON Patch 应用器,只覆盖本项目 STATE_DELTA 用到的 add / replace / remove。
// 用于「客户端重放收到的事件 == 服务端写入数据库 state」这条不变量断言(见 KI-1)。

import type { JsonPatchOp } from '@incipel/shared';

function parsePointer(path: string): string[] {
  return path
    .split('/')
    .slice(1)
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function applyPatch<T>(doc: T, ops: JsonPatchOp[]): T {
  const root = structuredClone(doc) as unknown as Record<string, unknown>;
  for (const op of ops) {
    const segs = parsePointer(op.path);
    const last = segs[segs.length - 1]!;
    let parent: any = root;
    for (let i = 0; i < segs.length - 1; i++) parent = parent[segs[i]!];
    if (op.op === 'add') {
      if (Array.isArray(parent)) parent.splice(last === '-' ? parent.length : Number(last), 0, op.value);
      else parent[last] = op.value;
    } else if (op.op === 'replace') {
      parent[last] = op.value;
    } else if (op.op === 'remove') {
      if (Array.isArray(parent)) parent.splice(Number(last), 1);
      else delete parent[last];
    }
  }
  return root as unknown as T;
}
