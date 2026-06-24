import { describe, expect, it } from 'vitest';
import { welcomeStartParams } from './start-params';

describe('welcomeStartParams', () => {
  it('空白灵感不会生成聊天页参数', () => {
    expect(welcomeStartParams('   ', () => 'thread-1')).toBeNull();
  });

  it('有内容时去掉首尾空白并生成 threadId', () => {
    expect(welcomeStartParams('  一个故事  ', () => 'thread-1')).toEqual({
      idea: '一个故事',
      threadId: 'thread-1',
    });
  });
});
