const SAFE_NULL_REACT_NATIVE_GETTERS = ['PushNotificationIOS'] as const;

export function installReactNativeCompat(reactNativeExports: object) {
  for (const exportName of SAFE_NULL_REACT_NATIVE_GETTERS) {
    const descriptor = Object.getOwnPropertyDescriptor(reactNativeExports, exportName);
    if (!descriptor?.get || descriptor.configurable === false) continue;

    Object.defineProperty(reactNativeExports, exportName, {
      configurable: true,
      enumerable: false,
      get() {
        return null;
      },
    });
  }
}
