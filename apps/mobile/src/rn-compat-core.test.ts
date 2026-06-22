import { describe, expect, it, vi } from 'vitest';
import { installReactNativeCompat } from './rn-compat-core';

describe('installReactNativeCompat', () => {
  it('replaces the unused PushNotificationIOS getter without evaluating it', () => {
    const reactNativeExports: Record<string, unknown> = {};
    const getter = vi.fn(() => {
      throw new Error('should not evaluate');
    });

    Object.defineProperty(reactNativeExports, 'PushNotificationIOS', {
      configurable: true,
      enumerable: true,
      get: getter,
    });

    installReactNativeCompat(reactNativeExports);

    expect(getter).not.toHaveBeenCalled();
    expect(Object.keys(reactNativeExports)).not.toContain('PushNotificationIOS');
    expect(reactNativeExports.PushNotificationIOS).toBeNull();
  });
});
