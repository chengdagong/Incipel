const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

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
