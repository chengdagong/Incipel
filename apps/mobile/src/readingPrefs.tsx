// 阅读区字号 / 行距偏好。照搬 i18n 的 provider 写法:启动读 AsyncStorage、改动写回。
// 仅作用于剧本内容(经 ReaderText);键 scn_read_font_v1 / scn_read_line_v1,默认标准档。

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  FONT_SCALES,
  LINE_SCALES,
  PARA_SCALES,
  normalizeFontLevel,
  normalizeLineLevel,
  normalizeParaLevel,
  type FontLevel,
  type LineLevel,
  type ParaLevel,
} from './readingScale';

const FONT_KEY = 'scn_read_font_v1';
const LINE_KEY = 'scn_read_line_v1';
const PARA_KEY = 'scn_read_para_v1';

export type ReadingPrefs = {
  fontLevel: FontLevel;
  lineLevel: LineLevel;
  paraLevel: ParaLevel;
  setFontLevel: (l: FontLevel) => void;
  setLineLevel: (l: LineLevel) => void;
  setParaLevel: (l: ParaLevel) => void;
  fontScale: number;
  lineScale: number;
  paraScale: number;
};

const ReadingPrefsContext = createContext<ReadingPrefs | null>(null);

export function ReadingPrefsProvider({ children }: { children: React.ReactNode }) {
  const [fontLevel, setFontLevelState] = useState<FontLevel>('standard');
  const [lineLevel, setLineLevelState] = useState<LineLevel>('standard');
  const [paraLevel, setParaLevelState] = useState<ParaLevel>('standard');

  // 启动时读回上次选择(默认标准档);读取失败不阻塞。
  useEffect(() => {
    let mounted = true;
    Promise.all([AsyncStorage.getItem(FONT_KEY), AsyncStorage.getItem(LINE_KEY), AsyncStorage.getItem(PARA_KEY)])
      .then(([f, l, p]) => {
        if (!mounted) return;
        if (f != null) setFontLevelState(normalizeFontLevel(f));
        if (l != null) setLineLevelState(normalizeLineLevel(l));
        if (p != null) setParaLevelState(normalizeParaLevel(p));
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const setFontLevel = useCallback((l: FontLevel) => {
    setFontLevelState(l);
    void AsyncStorage.setItem(FONT_KEY, l).catch(() => {});
  }, []);
  const setLineLevel = useCallback((l: LineLevel) => {
    setLineLevelState(l);
    void AsyncStorage.setItem(LINE_KEY, l).catch(() => {});
  }, []);
  const setParaLevel = useCallback((l: ParaLevel) => {
    setParaLevelState(l);
    void AsyncStorage.setItem(PARA_KEY, l).catch(() => {});
  }, []);

  const api = useMemo<ReadingPrefs>(
    () => ({
      fontLevel,
      lineLevel,
      paraLevel,
      setFontLevel,
      setLineLevel,
      setParaLevel,
      fontScale: FONT_SCALES[fontLevel],
      lineScale: LINE_SCALES[lineLevel],
      paraScale: PARA_SCALES[paraLevel],
    }),
    [fontLevel, lineLevel, paraLevel, setFontLevel, setLineLevel, setParaLevel],
  );
  return <ReadingPrefsContext.Provider value={api}>{children}</ReadingPrefsContext.Provider>;
}

export function useReadingPrefs(): ReadingPrefs {
  const ctx = useContext(ReadingPrefsContext);
  if (!ctx) throw new Error('useReadingPrefs 必须在 ReadingPrefsProvider 内使用');
  return ctx;
}
