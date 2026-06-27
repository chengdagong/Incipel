import {
  BaseProcessor,
  type ProcessInputStepArgs,
  type ProcessInputStepResult,
} from '@mastra/core/processors';
import {
  OPENROUTER_WEB_FETCH_TOOL_NAME,
  OPENROUTER_WEB_SEARCH_TOOL_NAME,
} from '../tools/openrouter-tools.ts';

const WEB_REQUEST_PATTERN =
  /https?:\/\/|www\.|url\b|search\b|web\b|internet\b|online\b|browse\b|fetch\b|latest\b|recent\b|real[-\s]?time\b|today\b|tomorrow\b|weather\b|news\b|搜索|搜一下|查找|查询|检索|联网|网上|互联网|网页|页面|链接|网址|最新|近期|实时|天气|新闻/iu;

export class OpenRouterWebToolPolicyProcessor extends BaseProcessor<'openrouter-web-tool-policy'> {
  readonly id = 'openrouter-web-tool-policy';
  readonly name = 'OpenRouter Web Tool Policy';

  processInputStep(args: ProcessInputStepArgs): ProcessInputStepResult | undefined {
    if (args.stepNumber !== 0) return undefined;
    if (!hasOpenRouterWebTools(args.tools)) return undefined;
    if (!shouldUseOpenRouterWebTools(args.messages)) return undefined;

    return {
      activeTools: [OPENROUTER_WEB_SEARCH_TOOL_NAME, OPENROUTER_WEB_FETCH_TOOL_NAME],
      toolChoice: 'required',
    };
  }
}

export function shouldUseOpenRouterWebTools(messages: unknown): boolean {
  return WEB_REQUEST_PATTERN.test(latestUserText(messages));
}

function hasOpenRouterWebTools(tools: unknown): boolean {
  if (!tools || typeof tools !== 'object') return false;
  const toolRecord = tools as Record<string, unknown>;
  return Boolean(toolRecord[OPENROUTER_WEB_SEARCH_TOOL_NAME] && toolRecord[OPENROUTER_WEB_FETCH_TOOL_NAME]);
}

function latestUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return stringifyText(messages);

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && typeof message === 'object' && 'role' in message && message.role === 'user') {
      return stringifyText(message);
    }
  }

  return stringifyText(messages);
}

function stringifyText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(stringifyText).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';

  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text;
  if (record.text && typeof record.text === 'object') return stringifyText(record.text);
  if (typeof record.content === 'string') return record.content;
  if (record.content && typeof record.content === 'object') return stringifyText(record.content);
  if (typeof record.message === 'string') return record.message;
  if (record.message && typeof record.message === 'object') return stringifyText(record.message);
  if (record.parts && typeof record.parts === 'object') return stringifyText(record.parts);

  return Object.values(record).map(stringifyText).filter(Boolean).join('\n');
}
