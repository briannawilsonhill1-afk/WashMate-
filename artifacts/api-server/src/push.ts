import { db } from "./db";
import { deviceTokens, users, washerProfiles } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { logger } from "./lib/logger";
import { PushReceiptQueue } from "./pushReceipts";


const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_MAX_MESSAGES_PER_REQUEST = 100;
const receiptQueue = new PushReceiptQueue(removeTokens);

export interface ExpoPushMessage {
  to: string;
  title?: string;
  body?: string;
  sound?: "default" | null;
  data?: Record<string, unknown>;
  badge?: number;
}

export function buildNewOrderPushMessages(tokens: string[], orderId: number): ExpoPushMessage[] {
  return tokens.map((token) => ({
    to: token,
    sound: "default",
    title: "New laundry job available",
    body: "Open WashMate to view and claim the new job.",
    data: { orderId, type: "new_order" },
  }));
}

export function chunkPushMessages(messages: ExpoPushMessage[]): ExpoPushMessage[][] {
  const chunks: ExpoPushMessage[][] = [];
  for (let start = 0; start < messages.length; start += EXPO_MAX_MESSAGES_PER_REQUEST) {
    chunks.push(messages.slice(start, start + EXPO_MAX_MESSAGES_PER_REQUEST));
  }
  return chunks;
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoPushResponse {
  data?: ExpoPushTicket[];
  errors?: { message: string }[];
}

export function isExpoPushToken(token: string): boolean {
  return /^Expo(?:nent)?PushToken\[[^\]]+\]$/.test(token);
}

export async function registerDeviceToken(
  userId: string,
  token: string,
  platform: "ios" | "android" | "web" = "ios",
): Promise<void> {
  if (!isExpoPushToken(token)) {
    throw new Error("INVALID_PUSH_TOKEN");
  }

  // Atomically (re)bind this device token to the calling user. Possession of
  // a valid Expo push token, presented by a Clerk-authenticated request, is
  // treated as proof that the caller controls the underlying handset: Expo
  // tokens are device-scoped credentials issued by the OS push registration
  // flow, and the iOS shell only injects them into first-party WashMate
  // origins (see artifacts/washmate-ios/app/index.tsx).
  //
  // Crucially, this OVERWRITES the previous owner's row when the same token
  // re-appears under a different userId. That is the documented fail-safe for
  // the shared-device / failed-logout case (threat_model.md "Information
  // Disclosure"): if user A logs out while offline and the DELETE never
  // reaches the server, user B signing in on the same handset must be able
  // to claim the token so A no longer receives B's order pushes — and so B
  // actually starts receiving their own.
  //
  // The previous behavior (throw TOKEN_OWNED_BY_OTHER_USER on collision)
  // failed open in the wrong direction: it left the stale binding in place
  // forever, allowing one shared-device user to keep receiving notifications
  // for the next user of the handset until the row was eventually pruned.
  //
  // SECURITY INVARIANT: This upsert MUST remain an overwrite (not a reject) on
  // token collision. Reverting to a uniqueness-conflict rejection re-opens the
  // shared-device stale-binding vulnerability described in threat_model.md
  // ("Information Disclosure") and task-43. Verify via: POST /api/device-tokens
  // with a token already owned by user A while authenticated as user B must
  // return 204 and transfer the binding to user B.
  await db
    .insert(deviceTokens)
    .values({ userId, token, platform })
    .onConflictDoUpdate({
      target: deviceTokens.token,
      set: { userId, platform, updatedAt: new Date() },
    });
}

async function getTokensForUser(userId: string): Promise<string[]> {
  const rows = await db
    .select({ token: deviceTokens.token })
    .from(deviceTokens)
    .where(eq(deviceTokens.userId, userId));
  return rows.map((r) => r.token);
}

async function removeTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await db.delete(deviceTokens).where(inArray(deviceTokens.token, tokens));
}

export async function unregisterDeviceToken(
  userId: string,
  token: string,
): Promise<void> {
  await db
    .delete(deviceTokens)
    .where(and(eq(deviceTokens.userId, userId), eq(deviceTokens.token, token)));
}

export async function sendPushToUser(
  userId: string,
  payload: Omit<ExpoPushMessage, "to">,
): Promise<void> {
  const tokens = await getTokensForUser(userId);
  if (tokens.length === 0) return;

  const messages: ExpoPushMessage[] = tokens.map((t) => ({
    to: t,
    sound: "default",
    ...payload,
  }));
  await sendPushMessages(messages, { userId });
}

async function sendPushMessages(
  messages: ExpoPushMessage[],
  logContext: Record<string, unknown>,
): Promise<void> {
  if (messages.length === 0) return;
  let json: ExpoPushResponse | undefined;
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, ...logContext }, "Expo push request failed");
      return;
    }
    json = (await res.json()) as ExpoPushResponse;
  } catch (err) {
    logger.warn({ err, ...logContext }, "Expo push network error");
    return;
  }

  // Clean up tokens that Expo says are invalid (e.g. uninstalled app)
  const tickets = json?.data ?? [];
  const stale: string[] = [];
  tickets.forEach((ticket, idx) => {
    if (ticket.status === "ok" && ticket.id && messages[idx]?.to) {
      receiptQueue.enqueue(ticket.id, messages[idx].to);
    }
    if (ticket.status === "error") {
      const code = ticket.details?.error;
      if (code === "DeviceNotRegistered") {
        const t = messages[idx]?.to;
        if (t) stale.push(t);
      } else {
        logger.warn({ ticket, ...logContext }, "Expo push ticket error");
      }
    }
  });
  if (stale.length > 0) {
    await removeTokens(stale).catch((err) =>
      logger.warn({ err }, "Failed to prune stale device tokens"),
    );
  }
}

export type OrderStatus =
  | "pending"
  | "accepted"
  | "picked_up"
  | "in_progress"
  | "out_for_delivery"
  | "completed";

export interface OrderStatusPushInput {
  customerId: string;
  orderId: number;
  status: OrderStatus;
}

const STATUS_COPY: Record<OrderStatus, { title: string; body: string } | null> = {
  pending: null,
  accepted: {
    title: "A washer claimed your order",
    body: "They'll be by to pick up your laundry soon.",
  },
  picked_up: {
    title: "Your laundry has been picked up",
    body: "We'll let you know when it starts washing.",
  },
  in_progress: {
    title: "Your laundry is being washed",
    body: "We'll let you know when it's on the way back.",
  },
  out_for_delivery: {
    title: "Your laundry is out for delivery",
    body: "Your washer is on the way to drop it off.",
  },
  completed: {
    title: "Your laundry has been delivered",
    body: "Thanks for using WashMate!",
  },
};

export async function notifyOrderStatusChange(input: OrderStatusPushInput): Promise<void> {
  const copy = STATUS_COPY[input.status];
  if (!copy) return;
  await sendPushToUser(input.customerId, {
    title: copy.title,
    body: copy.body,
    data: { orderId: input.orderId, status: input.status, type: "order_status" },
  }).catch((err) => logger.warn({ err, ...input }, "notifyOrderStatusChange failed"));
}

export async function notifyClearedWashersOfNewOrder(orderId: number): Promise<void> {
  try {
    const recipients = await db
      .select({ token: deviceTokens.token })
      .from(deviceTokens)
      .innerJoin(users, eq(users.id, deviceTokens.userId))
      .innerJoin(washerProfiles, eq(washerProfiles.userId, deviceTokens.userId))
      .where(and(
        eq(deviceTokens.platform, "ios"),
        eq(users.role, "washer"),
        eq(washerProfiles.bgCheckStatus, "cleared"),
      ));

    const messages = buildNewOrderPushMessages(
      recipients.map(({ token }) => token),
      orderId,
    );
    for (const batch of chunkPushMessages(messages)) {
      await sendPushMessages(
        batch,
        { orderId, notificationType: "new_order" },
      );
    }
  } catch (err) {
    logger.warn({ err, orderId }, "notifyClearedWashersOfNewOrder failed");
  }
}
