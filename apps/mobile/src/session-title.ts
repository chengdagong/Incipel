import type { Screenplay } from '@incipel/shared';

export const SESSION_TITLE_MAX_LENGTH = 80;

export function normalizeSessionTitle(input: string): string {
  return String(input ?? '').trim().slice(0, SESSION_TITLE_MAX_LENGTH);
}

export function applyScreenplayTitle(screenplay: Screenplay, title: string, updatedAt?: string): Screenplay {
  return {
    ...screenplay,
    meta: {
      ...screenplay.meta,
      title,
      updatedAt: updatedAt ?? new Date().toISOString(),
    },
  };
}

export function sessionTitleForDisplay(sessionTitle: string | null | undefined, screenplayTitle: string | null | undefined, fallback: string): string {
  return sessionTitle?.trim() || screenplayTitle?.trim() || fallback;
}

export function canEditSessionTitle({ isRunning, hydrating }: { isRunning: boolean; hydrating: boolean }): boolean {
  return !isRunning && !hydrating;
}
