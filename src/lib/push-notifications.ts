import webpush from "web-push";
import { env } from "./env";
import {
  deletePushSubscription,
  listPushSubscriptions,
} from "./push-subscriptions";

export type PhoneNotification = {
  title: string;
  body: string;
  tag: string;
  url?: string;
};

export async function sendPhoneNotification(
  notification: PhoneNotification,
): Promise<void> {
  if (!env.webPushConfigured) return;
  const publicKey = env.webPushVapidPublicKey;
  const privateKey = env.webPushVapidPrivateKey;
  const subject = env.webPushSubject;
  if (!publicKey || !privateKey || !subject) return;

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const subscriptions = await listPushSubscriptions();
  await Promise.allSettled(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          subscription,
          JSON.stringify({
            ...notification,
            url: notification.url ?? "/",
          }),
          { TTL: 60 * 60 },
        );
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await deletePushSubscription(subscription.endpoint);
          return;
        }
        throw error;
      }
    }),
  );
}
