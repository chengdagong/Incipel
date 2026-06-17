// 对话屏。用 useScreenplayAgent(threadId) 消费 AG-UI 共享状态(Screenplay)与文本流:
// 渲染消息、流式打字气泡、内联卡片(本轮剧本相对上一版的新增实体)、可点选项、输入栏;
// 右上「文档」开关 DocPanel。阶段用 @incipel/shared 的 deriveStage / STAGE_LABELS 显示(system-design §5)。

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  type Character,
  type Message,
  type Screenplay,
  STAGE_LABELS,
  deriveStage,
  emptyScreenplay,
} from '@incipel/shared';
import { useScreenplayAgent, newThreadId } from '../src/agui/client';
import { Composer } from '../src/components/Composer';
import { DocPanel } from '../src/components/DocPanel';
import { InlineCard, type InlineCardData } from '../src/components/InlineCard';
import { defaultTheme } from '../src/theme';

// 取 AG-UI Message 的纯文本内容(user 消息可为多模态数组,这里只取文本部分)。
function messageText(m: Message): string {
  const content = (m as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text) : ''))
      .join('');
  }
  return '';
}

// 本轮新增实体切片 = 当前剧本里、上一版剧本中不存在的那些 id(system-design §6.2:内联卡片即本轮 STATE_DELTA)。
function diffCard(prev: Screenplay, next: Screenplay): InlineCardData {
  const newOnly = <T extends { id: string }>(before: T[], after: T[]): T[] => {
    const had = new Set(before.map((x) => x.id));
    return after.filter((x) => !had.has(x.id));
  };
  return {
    world: newOnly(prev.world, next.world),
    characters: newOnly(prev.characters, next.characters),
    outline: newOnly(prev.outline, next.outline),
    scenes: newOnly(prev.scenes, next.scenes),
  };
}

export default function ChatScreen() {
  const params = useLocalSearchParams<{ idea?: string; sessionId?: string; threadId?: string; view?: string }>();
  const { palette } = defaultTheme;

  // threadId = 会话 id:续写时来自路由(sessionId / threadId),否则现生成一个新的。
  const [threadId] = useState<string>(() => params.sessionId ?? params.threadId ?? newThreadId());

  const { messages, screenplay, streamingText, options, isRunning, error, sendMessage } =
    useScreenplayAgent(threadId);

  // 「作品」入口可带 view=doc 直接进文档视图。
  const [docOpen, setDocOpen] = useState(params.view === 'doc');

  const stage = useMemo(() => deriveStage(screenplay), [screenplay]);

  // 首轮:挂载时把欢迎页带来的 idea 作为第一条用户消息发出(只发一次)。
  const sentIdea = useRef(false);
  useEffect(() => {
    const idea = params.idea ? String(params.idea).trim() : '';
    if (idea && !sentIdea.current) {
      sentIdea.current = true;
      void sendMessage(idea);
    }
  }, [params.idea, sendMessage]);

  // 内联卡片:把「上一次 assistant 消息落定时的剧本」与「当前剧本」对比,得出本轮新增。
  // 记录上一版剧本快照;每当 assistant 文本数 +1(本轮结束)时刷新基线。
  const prevScreenplayRef = useRef<Screenplay>(emptyScreenplay());
  const assistantCountRef = useRef(0);
  const assistantCount = messages.filter((m) => m.role === 'assistant').length;
  const card = useMemo(() => {
    const c = diffCard(prevScreenplayRef.current, screenplay);
    return c;
    // 仅依赖 screenplay:其变化即本轮 STATE_DELTA 的累计结果。
  }, [screenplay]);
  useEffect(() => {
    // 本轮收尾(多了一条 assistant 消息且不再 running)时,把当前剧本设为下一轮的对比基线。
    if (assistantCount > assistantCountRef.current && !isRunning) {
      assistantCountRef.current = assistantCount;
      prevScreenplayRef.current = screenplay;
    }
  }, [assistantCount, isRunning, screenplay]);

  // 点人物卡「聊聊 TA」:发一条聚焦该角色的消息(带 character.id)。
  function focusCharacter(c: Character) {
    void sendMessage(`我想再聊聊角色「${c.name}」(id: ${c.id})。`);
    setDocOpen(false);
  }

  if (docOpen) {
    return (
      <View style={[styles.screen, { backgroundColor: palette.pageBg }]}>
        <Header stage={STAGE_LABELS[stage]} docOpen onToggleDoc={() => setDocOpen((v) => !v)} />
        <DocPanel screenplay={screenplay} onFocusCharacter={focusCharacter} />
      </View>
    );
  }

  // 最后一条 assistant 消息挂本轮卡片与选项(瞬时,随下一轮清空)。
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;

  return (
    <View style={[styles.screen, { backgroundColor: palette.pageBg }]}>
      <Header stage={STAGE_LABELS[stage]} docOpen={false} onToggleDoc={() => setDocOpen((v) => !v)} />

      <ScrollView style={styles.thread} contentContainerStyle={styles.threadContent}>
        {messages.map((m) => {
          const isAssistant = m.role === 'assistant';
          const isLastAssistant = isAssistant && m.id === lastAssistantId;
          return (
            <MessageBubble
              key={m.id}
              role={m.role === 'user' ? 'user' : 'assistant'}
              text={messageText(m)}
              card={isLastAssistant ? card : undefined}
              options={isLastAssistant ? options : undefined}
              onSend={sendMessage}
              onOpenDoc={() => setDocOpen(true)}
            />
          );
        })}

        {/* 正在流式打字的 assistant 气泡(本轮尚未落定为一条消息)。 */}
        {isRunning && !!streamingText && (
          <MessageBubble role="assistant" text={streamingText} streaming onSend={sendMessage} onOpenDoc={() => setDocOpen(true)} />
        )}

        {!!error && (
          <Text style={[styles.error, { color: defaultTheme.accent }]}>出错了:{error}</Text>
        )}
      </ScrollView>

      <Composer busy={isRunning} onSend={sendMessage} />
    </View>
  );
}

function Header({
  stage,
  docOpen,
  onToggleDoc,
}: {
  stage: string;
  docOpen: boolean;
  onToggleDoc: () => void;
}) {
  const { palette } = defaultTheme;
  return (
    <View style={[styles.header, { borderColor: palette.border }]}>
      <Text style={[styles.stage, { color: defaultTheme.accent }]}>{stage}</Text>
      <Pressable onPress={onToggleDoc} accessibilityRole="button">
        <Text style={[styles.docToggle, { color: palette.textSecondary }]}>
          {docOpen ? '← 返回对话' : '文档'}
        </Text>
      </Pressable>
    </View>
  );
}

function MessageBubble({
  role,
  text,
  streaming,
  card,
  options,
  onSend,
  onOpenDoc,
}: {
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
  card?: InlineCardData;
  options?: string[];
  onSend: (text: string) => void;
  onOpenDoc: () => void;
}) {
  const { palette } = defaultTheme;
  const isUser = role === 'user';
  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: isUser ? defaultTheme.accent : palette.cardBg,
            borderColor: palette.border,
          },
        ]}
      >
        <Text style={[styles.bubbleText, { color: isUser ? '#fff' : palette.textPrimaryAlt }]}>
          {text}
          {streaming ? '▋' : ''}
        </Text>
      </View>

      {/* 内联卡片:本轮新增实体(由剧本 diff 得出)。 */}
      {!isUser && card && <InlineCard data={card} onOpenDoc={onOpenDoc} />}

      {/* 可点选项(quick reply):点击即以用户身份发该文本。 */}
      {!isUser && !!options?.length && (
        <View style={styles.options}>
          {options.map((opt) => (
            <Pressable
              key={opt}
              style={[styles.option, { borderColor: defaultTheme.accent }]}
              onPress={() => onSend(opt)}
            >
              <Text style={[styles.optionLabel, { color: defaultTheme.accent }]}>{opt}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  stage: { fontSize: 13, fontWeight: '600' },
  docToggle: { fontSize: 14, fontWeight: '600' },
  thread: { flex: 1 },
  threadContent: { padding: 16, gap: 12 },
  row: { gap: 6 },
  rowUser: { alignItems: 'flex-end' },
  rowAssistant: { alignItems: 'flex-start' },
  bubble: { maxWidth: '85%', borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  optionLabel: { fontSize: 13, fontWeight: '600' },
  error: { fontSize: 13, fontWeight: '600' },
});
