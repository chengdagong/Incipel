// 设置区嵌套栈:索引页(index)+ 各类别详情页(account / general / reading / developer)。
// 各屏自绘顶栏(返回 + 标题,见 SettingsScaffold),与 history / works 一致,故隐藏原生 Stack 顶栏。
// 父级 (app)/_layout 仍以 name="settings" 注册整组,此处只配置组内栈。

import { Stack } from 'expo-router';

export default function SettingsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
