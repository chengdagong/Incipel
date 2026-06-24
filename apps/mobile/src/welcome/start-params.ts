export type WelcomeStartParams = {
  idea: string;
  threadId: string;
};

export function welcomeStartParams(
  idea: string,
  makeThreadId: () => string,
): WelcomeStartParams | null {
  const trimmedIdea = idea.trim();
  if (!trimmedIdea) return null;
  return { idea: trimmedIdea, threadId: makeThreadId() };
}
