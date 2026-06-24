import { describe, expect, it } from 'vitest';
import { scaleReaderStyle } from './readingScale';
import { DOCUMENT_BODY_TEXT_STYLE, DOCUMENT_TEXT_STYLES } from './docTypography';

describe('docTypography', () => {
  it('人物小传和普通文档正文使用同一份基础字号与行高', () => {
    expect(DOCUMENT_TEXT_STYLES.worldBody).toBe(DOCUMENT_BODY_TEXT_STYLE);
    expect(DOCUMENT_TEXT_STYLES.beatBody).toBe(DOCUMENT_BODY_TEXT_STYLE);
    expect(DOCUMENT_TEXT_STYLES.characterBio).toBe(DOCUMENT_BODY_TEXT_STYLE);
  });

  it('人物小传和普通文档正文接受相同的阅读设置缩放', () => {
    const fontScale = 1.15;
    const lineScale = 1.15;

    expect(scaleReaderStyle(DOCUMENT_TEXT_STYLES.characterBio, fontScale, lineScale)).toEqual(
      scaleReaderStyle(DOCUMENT_TEXT_STYLES.worldBody, fontScale, lineScale),
    );
  });
});
