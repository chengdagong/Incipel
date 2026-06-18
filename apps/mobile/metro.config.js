const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const config = getDefaultConfig(__dirname);

// ── 多 worktree 缓存隔离 ──────────────────────────────────────────────
// Metro 的 transform 缓存(cacheStores 里的 FileStore)默认根在 os.tmpdir()/metro-cache,
// 是机器级共享位置;多个 git worktree 并行跑 `expo start` 会写同一目录,产生并发写竞争
// (facebook/metro#331)。这里按「本 worktree 的绝对路径」派生唯一缓存根,使每个 worktree
// 各用各的 transform 缓存——不依赖 dev 脚本,直接 `expo start` 也隔离。
//
// 注:file-map 缓存(fileMapCacheDirectory)刻意不改。它的默认位置同样是 os.tmpdir(),
// 但缓存文件名内含「监视根目录」的哈希,不同 worktree 天然得到不同文件名、不会串扰;
// 而自定义该目录有两个坑:@expo/metro-config 的校验器尚不识别该键(报 Unknown option),
// 且 Metro 不会自动创建该目录,自定义路径会触发 ENOENT 写入失败。保持默认最稳。
const worktreeRoot = path.resolve(__dirname, '..', '..');
const worktreeToken = crypto.createHash('md5').update(worktreeRoot).digest('hex').slice(0, 8);
const transformCacheRoot = path.join(os.tmpdir(), `metro-incipel-${worktreeToken}`);
fs.mkdirSync(transformCacheRoot, { recursive: true }); // FileStore 不会自建根目录,需手动创建

const defaultStore = Array.isArray(config.cacheStores) ? config.cacheStores[0] : null;
if (defaultStore && typeof defaultStore.constructor === 'function') {
  const FileStore = defaultStore.constructor;
  config.cacheStores = [new FileStore({ root: transformCacheRoot })];
}

// ── 既有解析逻辑(保持不变)───────────────────────────────────────────
// SDK 52 的 Metro 默认不开 package `exports` 解析。实测全局开启它会引入运行时
// "Requiring unknown module undefined"(package-exports 的粗糙边),故保持关闭。
config.resolver.unstable_enablePackageExports = false;

// 唯一离不开 exports 的子路径是 @ag-ui/proto → @bufbuild/protobuf/<sub>:
// @bufbuild/protobuf v2 的 `.` 有 main(关 exports 也能解析),但 ./wire 等子路径只经 exports
// 暴露、无物理根文件。这里做精确别名,指到物理 CJS 文件,从而无需全局开 package exports。
const baseResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const m = moduleName.match(/^@bufbuild\/protobuf\/(.+)$/);
  if (m) {
    return context.resolveRequest(
      context,
      `@bufbuild/protobuf/dist/cjs/${m[1]}/index.js`,
      platform,
    );
  }
  return (baseResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
