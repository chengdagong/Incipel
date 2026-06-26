import { createScorer, type MastraScorers } from '@mastra/core/evals';

export const incipelResponseCompletenessScorer = createScorer({
  id: 'incipel-response-completeness',
  description: 'Scores whether an Incipel agent response contains non-empty text.',
  type: 'agent',
}).generateScore(({ run }) => (extractOutputText(run.output).trim().length > 0 ? 1 : 0));

export const incipelAgentScorers = {
  incipelResponseCompleteness: {
    scorer: incipelResponseCompletenessScorer,
    sampling: { type: 'ratio', rate: 1 },
  },
} satisfies MastraScorers;

export const incipelMastraScorers = {
  incipelResponseCompleteness: incipelResponseCompletenessScorer,
};

function extractOutputText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(extractOutputText).join('\n');
  if (!value || typeof value !== 'object') return '';

  const record = value as Record<string, unknown>;
  return [
    extractOutputText(record.content),
    extractOutputText(record.text),
    extractOutputText(record.parts),
  ]
    .filter(Boolean)
    .join('\n');
}
