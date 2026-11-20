import { z } from "zod";

import { idSchema, Timestamp } from "./common";

export const DeviceId = idSchema("device");

export const DevicePlatform = z.enum(["android", "ios"]);

/**
 * A phone that receives pushes. `pushToken` is the raw FCM registration token
 * from `getDevicePushTokenAsync()`, not an Expo push token.
 */
export const Device = z.object({
  id: DeviceId,
  name: z.string().min(1).max(80),
  platform: DevicePlatform,
  appVersion: z.string().max(32).nullable(),
  lastSeenAt: Timestamp,
  createdAt: Timestamp,
});
export type Device = z.infer<typeof Device>;

/** Upserts by `pushToken`; call on every app start and whenever the token rotates. */
export const RegisterDeviceInput = z.object({
  pushToken: z.string().min(1).max(4096),
  name: z.string().min(1).max(80),
  platform: DevicePlatform,
  appVersion: z.string().max(32).optional(),
});

export const RenameDeviceInput = z.object({
  id: DeviceId,
  name: z.string().min(1).max(80),
});
