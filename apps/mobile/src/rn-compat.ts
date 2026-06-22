import { installReactNativeCompat } from './rn-compat-core';

declare const require: (id: string) => object;

// React Native 0.83 still exposes PushNotificationIOS as an enumerable getter.
// The native module has been extracted, so reading that getter can build
// NativeEventEmitter(null) on iOS even when the app never uses notifications.
installReactNativeCompat(require('react-native'));
