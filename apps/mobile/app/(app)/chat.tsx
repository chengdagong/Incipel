// 对话屏。用 useScreenplayAgent(threadId) 消费 AG-UI 共享状态(Screenplay)与文本流:
// 渲染消息、流式打字气泡、内联卡片(本轮剧本相对上一版的新增实体)、可点选项、输入栏;
// 右上「文档」开关 DocPanel。阶段由 deriveStage 派生,再经 STAGE_TKEY 映射到可切换文案显示(system-design §5)。

import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  type Character,
  type CharacterAttr,
  type Message,
  type Screenplay,
  deriveStage,
  emptyScreenplay,
} from '@incipel/shared';
import { useScreenplayAgent, newThreadId } from '../../src/agui/client';
import { Composer, type ComposerHandle } from '../../src/components/Composer';
import { DocSheet } from '../../src/components/DocPanel';
import { PortraitSheet } from '../../src/components/PortraitSheet';
import { PortraitProvider } from '../../src/portrait';
import { InlineCard, type InlineCardData } from '../../src/components/InlineCard';
import { chipFromAttr, chipFromCharacter, composeFocusMessage, type FocusChip } from '../../src/focus';
import { DEFAULT_ASSISTANT_NAME } from '../../src/config';
import { useT, STAGE_TKEY } from '../../src/i18n';
import { defaultTheme } from '../../src/theme';

// 阶段 → i18n key 的映射统一放在 src/i18n.tsx(STAGE_TKEY),与作品列表共用。

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
  const t = useT();

  const { messages, screenplay, streamingText, options, isRunning, error, sendMessage, retry } =
    useScreenplayAgent(threadId);

  // 「作品」入口可带 view=doc 直接进文档视图。
  const [docOpen, setDocOpen] = useState(params.view === 'doc');

  // 聚焦标签(#12):瞬时;发送时拼进消息、随即清空。
  const [chips, setChips] = useState<FocusChip[]>([]);
  const composerRef = useRef<ComposerHandle>(null);

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

  // 聚焦标签:点属性 / 点人物 → 加一枚 chip,关文档面板并聚焦输入框(对齐原型 discussAttr/discussCharacter)。
  function addChip(chip: FocusChip) {
    setChips((prev) => (prev.some((c) => c.key === chip.key) ? prev : [...prev, chip]));
    setDocOpen(false);
    setTimeout(() => composerRef.current?.focus(), 50);
  }
  const removeChip = (key: string) => setChips((prev) => prev.filter((c) => c.key !== key));
  const focusAttr = (c: Character, a: CharacterAttr) => addChip(chipFromAttr(c, a, t));
  const focusCharacter = (c: Character) => addChip(chipFromCharacter(c, t));

  // Composer 发送:把聚焦 chip 拼进消息(空正文 + 有 chip 时用兜底话术),发出后清空 chip。
  function sendComposed(text: string) {
    const msg = composeFocusMessage(text, chips, t);
    if (!msg) return;
    setChips([]);
    void sendMessage(msg);
  }
  // 快捷选项 / 直接发送:不带聚焦上下文,但发送即清空残留 chip(对齐原型 pushUserAndReply)。
  function sendPlain(text: string) {
    setChips([]);
    void sendMessage(text);
  }

  // 最后一条 assistant 消息挂本轮卡片与选项(瞬时,随下一轮清空)。
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;

  return (
    <PortraitProvider>
    <View style={[styles.screen, { backgroundColor: palette.pageBg }]}>
      <Header
        title={title}
        stage={t(STAGE_TKEY[stage])}
        docOpen={docOpen}
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
              onSend={sendPlain}
              onOpenDoc={() => setDocOpen(true)}
              onFocusAttr={focusAttr}
              onFocusCharacter={focusCharacter}
            />
          );
        })}

        {/* 思考中(本轮已开始、首 token 未到):三点动画(对齐原型 typing dots)。 */}
        {isRunning && !streamingText && <ThinkingDots />}

        {/* 正在流式打字的 assistant 气泡(本轮尚未落定为一条消息)。 */}
        {isRunning && !!streamingText && (
          <MessageBubble role="assistant" text={streamingText} streaming onSend={sendPlain} onOpenDoc={() => setDocOpen(true)} />
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

      <Composer
        ref={composerRef}
        busy={isRunning}
        onSend={sendComposed}
        chips={chips}
        onRemoveChip={removeChip}
      />

      {/* 文档面板:从底部滑出的浮层,覆盖在对话之上;收起按钮在面板内(system-design §2.1 / #11)。 */}
      <DocSheet
        open={docOpen}
        onClose={() => setDocOpen(false)}
        screenplay={screenplay}
        onFocusCharacter={focusCharacter}
        onFocusAttr={focusAttr}
      />

      {/* 肖像生成弹窗(#14):从 usePortrait() 读 sheetChar,卡片点「生成肖像」/↻ 唤出。 */}
      <PortraitSheet />
    </View>
    </PortraitProvider>
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
  const t = useT();
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
          <Text style={[styles.headerSub, { color: palette.textSecondary }]}>
            {t('stagePrefix')}
            {stage}
          </Text>
        </View>

        <Pressable
          onPress={onToggleDoc}
          style={[styles.docChip, { backgroundColor: palette.cardBg, borderColor: palette.border }]}
          accessibilityRole="button"
        >
          <View
            style={[styles.docDot, { backgroundColor: docOpen ? defaultTheme.accent : palette.dot }]}
          />
          <Text style={[styles.docChipLabel, { color: palette.textPrimary }]}>{t('docBtn')}</Text>
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
  onFocusAttr,
  onFocusCharacter,
}: {
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
  card?: InlineCardData;
  options?: string[];
  onSend: (text: string) => void;
  onOpenDoc: () => void;
  onFocusAttr?: (c: Character, a: CharacterAttr) => void;
  onFocusCharacter?: (c: Character) => void;
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
        {streaming ? <BlinkCaret /> : null}
      </Text>

      {/* 内联卡片:本轮新增实体(由剧本 diff 得出);人物属性可点生成聚焦标签(#12)。 */}
      {card && (
        <InlineCard
          data={card}
          onOpenDoc={onOpenDoc}
          onFocusAttr={onFocusAttr}
          onFocusCharacter={onFocusCharacter}
        />
      )}

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

// 流式打字光标:主色细竖条,闪烁(对齐原型 caret)。
function BlinkCaret() {
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(op, { toValue: 0.1, duration: 500, useNativeDriver: true }),
        Animated.timing(op, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [op]);
  return <Animated.Text style={[styles.caret, { color: defaultTheme.accent, opacity: op }]}>▏</Animated.Text>;
}

// 思考中:助手头像 + 三点闪烁(首 token 到达前;对齐原型 typing dots)。
function ThinkingDots() {
  const { palette } = defaultTheme;
  return (
    <View style={styles.assistantBlock}>
      <View style={styles.assistantHeader}>
        <View style={[styles.avatar, { backgroundColor: palette.avatarBg }]}>
          <Text style={styles.avatarText}>{DEFAULT_ASSISTANT_NAME.slice(0, 1)}</Text>
        </View>
        <Text style={[styles.assistantName, { color: palette.textSecondary }]}>{DEFAULT_ASSISTANT_NAME}</Text>
      </View>
      <View style={styles.dots}>
        <Dot delay={0} />
        <Dot delay={200} />
        <Dot delay={400} />
      </View>
    </View>
  );
}

function Dot({ delay }: { delay: number }) {
  const op = useRef(new Animated.Value(0.2)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(op, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(op, { toValue: 0.2, duration: 400, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [op, delay]);
  return <Animated.View style={[styles.dot, { opacity: op }]} />;
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
  caret: { fontSize: 16, fontWeight: '700' },
  dots: { flexDirection: 'row', gap: 5, paddingVertical: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#BDB8AE' },

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
