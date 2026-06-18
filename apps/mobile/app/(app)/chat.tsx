// 对话屏。用 useScreenplayAgent(threadId) 消费 AG-UI 共享状态(Screenplay)与文本流:
// 渲染消息、流式打字气泡、内联卡片(本轮剧本相对上一版的新增实体)、可点选项、输入栏;
// 右上「文档」开关 DocPanel。阶段用 @incipel/shared 的 deriveStage / STAGE_LABELS 显示(system-design §5)。

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  type Character,
  type Message,
  type Screenplay,
  STAGE_LABELS,
  deriveStage,
  emptyScreenplay,
} from '@incipel/shared';
import { useScreenplayAgent, newThreadId } from '../../src/agui/client';
import { Composer } from '../../src/components/Composer';
import { DocPanel } from '../../src/components/DocPanel';
import { InlineCard, type InlineCardData } from '../../src/components/InlineCard';
import { DEFAULT_ASSISTANT_NAME } from '../../src/config';
import { defaultTheme } from '../../src/theme';

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
  const router = useRouter();
  const { palette } = defaultTheme;

  // threadId = 会话 id:续写时来自路由(sessionId / threadId),否则现生成一个新的。
  const [threadId] = useState<string>(() => params.sessionId ?? params.threadId ?? newThreadId());

  const { messages, screenplay, streamingText, options, isRunning, error, sendMessage, retry } =
    useScreenplayAgent(threadId);

  // 「作品」入口可带 view=doc 直接进文档视图。
  const [docOpen, setDocOpen] = useState(params.view === 'doc');

  const stage = useMemo(() => deriveStage(screenplay), [screenplay]);
  const title = screenplay.meta.title?.trim() || '无题';

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
        <Header
          title={title}
          stage={STAGE_LABELS[stage]}
          docOpen
          onBack={() => router.back()}
          onToggleDoc={() => setDocOpen((v) => !v)}
        />
        <DocPanel screenplay={screenplay} onFocusCharacter={focusCharacter} />
      </View>
    );
  }

  // 最后一条 assistant 消息挂本轮卡片与选项(瞬时,随下一轮清空)。
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;

  return (
    <View style={[styles.screen, { backgroundColor: palette.pageBg }]}>
      <Header
        title={title}
        stage={STAGE_LABELS[stage]}
        docOpen={false}
        onBack={() => router.back()}
        onToggleDoc={() => setDocOpen((v) => !v)}
      />

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
          <View style={styles.errorRow}>
            <Text style={[styles.error, { color: defaultTheme.accent }]}>出错了:{error}</Text>
            {/* 重试沿用同一 runId(经 hook 的 retry()),命中服务端幂等键,不重复落库(见 KI-2)。
                务必走 retry 而非重新 sendMessage——后者会生成新 runId、绕开幂等。 */}
            <Pressable
              onPress={() => void retry()}
              disabled={isRunning}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="重试本轮"
            >
              <Text style={[styles.retry, { color: defaultTheme.accent }]}>重试</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      <Composer busy={isRunning} onSend={sendMessage} />
    </View>
  );
}

function Header({
  title,
  stage,
  docOpen,
  onBack,
  onToggleDoc,
}: {
  title: string;
  stage: string;
  docOpen: boolean;
  onBack: () => void;
  onToggleDoc: () => void;
}) {
  const { palette } = defaultTheme;
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top, borderColor: palette.border }]}>
      <View style={styles.headerInner}>
        <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="返回">
          <Text style={[styles.backChevron, { color: palette.textSecondary }]}>‹</Text>
        </Pressable>

        <View style={styles.headerCenter} pointerEvents="none">
          <Text style={[styles.headerTitle, { color: palette.textPrimary }]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[styles.headerSub, { color: palette.textSecondary }]}>阶段 · {stage}</Text>
        </View>

        <Pressable
          onPress={onToggleDoc}
          style={[styles.docChip, { backgroundColor: palette.cardBg, borderColor: palette.border }]}
          accessibilityRole="button"
        >
          {docOpen ? (
            <Text style={[styles.docChipLabel, { color: palette.textPrimary }]}>← 返回对话</Text>
          ) : (
            <>
              <View style={[styles.docDot, { backgroundColor: palette.dot }]} />
              <Text style={[styles.docChipLabel, { color: palette.textPrimary }]}>文档</Text>
            </>
          )}
        </Pressable>
      </View>
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

  // 用户消息:右对齐暖灰气泡,深色文字。
  if (role === 'user') {
    return (
      <View style={styles.rowUser}>
        <View style={[styles.userBubble, { backgroundColor: palette.userBubbleBg }]}>
          <Text style={[styles.userText, { color: palette.textPrimary }]}>{text}</Text>
        </View>
      </View>
    );
  }

  // 助手的回复:头像(名字首字)+ 助手显示名,正文为页面上的纯文本(无气泡);其下挂内联卡片与选项列表。
  // assistantName 默认「主管编剧」,日后可由用户自定义(见 src/config.ts)。
  const assistantName = DEFAULT_ASSISTANT_NAME;
  return (
    <View style={styles.assistantBlock}>
      <View style={styles.assistantHeader}>
        <View style={[styles.avatar, { backgroundColor: palette.avatarBg }]}>
          <Text style={styles.avatarText}>{assistantName.slice(0, 1)}</Text>
        </View>
        <Text style={[styles.assistantName, { color: palette.textSecondary }]}>{assistantName}</Text>
      </View>

      <Text style={[styles.assistantText, { color: palette.textPrimary }]}>
        {text}
        {streaming ? '▋' : ''}
      </Text>

      {/* 内联卡片:本轮新增实体(由剧本 diff 得出)。 */}
      {card && <InlineCard data={card} onOpenDoc={onOpenDoc} />}

      {/* 可点选项(quick reply):带分隔线的列表,点击即以用户身份发该文本。 */}
      {!!options?.length && (
        <View style={styles.options}>
          {options.map((opt) => (
            <Pressable
              key={opt}
              style={[styles.optionRow, { borderTopColor: palette.border }]}
              onPress={() => onSend(opt)}
              accessibilityRole="button"
            >
              <Text style={[styles.optionArrow, { color: defaultTheme.accent }]}>▸</Text>
              <Text style={[styles.optionLabel, { color: palette.textPrimary }]}>{opt}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { borderBottomWidth: 1 },
  headerInner: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  backChevron: { fontSize: 30, lineHeight: 30, fontWeight: '300' },
  // 居中标题块:绝对覆盖在内栏上、屏幕水平居中;pointerEvents none,不挡两侧按钮。
  headerCenter: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '600', fontFamily: defaultTheme.fonts.serifTitle },
  headerSub: { fontSize: 12, marginTop: 2 },
  docChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  docDot: { width: 7, height: 7, borderRadius: 4 },
  docChipLabel: { fontSize: 13, fontWeight: '500' },

  thread: { flex: 1 },
  threadContent: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 12, gap: 22 },

  // 用户气泡
  rowUser: { alignItems: 'flex-end' },
  userBubble: { maxWidth: '84%', borderRadius: 18, paddingHorizontal: 16, paddingVertical: 12 },
  userText: { fontSize: 16, lineHeight: 26 },

  // 助手回复块
  assistantBlock: { width: '100%' },
  assistantHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 14, fontFamily: defaultTheme.fonts.serifTitle },
  assistantName: { fontSize: 14 },
  assistantText: { fontSize: 16, lineHeight: 26 },

  // 选项列表
  options: { marginTop: 14 },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 17,
    borderTopWidth: 1,
  },
  optionArrow: { fontSize: 11 },
  optionLabel: { fontSize: 16 },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  error: { fontSize: 13, fontWeight: '600' },
  retry: { fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
});
