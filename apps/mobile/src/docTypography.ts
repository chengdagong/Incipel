import type { ScalableText } from './readingScale';

export const DOCUMENT_BODY_TEXT_STYLE = {
  fontSize: 13,
  lineHeight: 23,
} satisfies Required<ScalableText>;

export const DOCUMENT_TEXT_STYLES = {
  worldBody: DOCUMENT_BODY_TEXT_STYLE,
  beatBody: DOCUMENT_BODY_TEXT_STYLE,
  characterBio: DOCUMENT_BODY_TEXT_STYLE,
} as const;
