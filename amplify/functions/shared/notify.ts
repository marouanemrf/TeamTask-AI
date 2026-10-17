import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { renderEmail } from "./emailTemplates";
import type { EmailContent } from "./emailTemplates";

/**
 * Notifications: email through SES (verified sender, SENDER_EMAIL secret), and optionally a chat
 * channel (Microsoft Teams or Slack incoming webhook). The webhook URL is a secret, kept in the
 * SecureString SSM parameter named by CHAT_WEBHOOK_PARAMETER; when it doesn't exist, chat
 * notifications are simply off. Failures are logged and reported, never thrown.
 */
const ses = new SESv2Client({});
const ssm = new SSMClient({});
let webhookCache: Promise<string | null> | null = null;

export async function sendEmail(to: string, sender: string, content: EmailContent): Promise<boolean> {
  const { html, text } = renderEmail(content);
  try {
    await ses.send(new SendEmailCommand({
      FromEmailAddress: sender,
      Destination: { ToAddresses: [to] },
      Content: { Simple: { Subject: { Data: content.subject, Charset: "UTF-8" }, Body: { Html: { Data: html, Charset: "UTF-8" }, Text: { Data: text, Charset: "UTF-8" } } } },
    }));
    return true;
  } catch (error) {
    console.error(JSON.stringify({ fn: "notify", channel: "EMAIL", error: error instanceof Error ? error.message : String(error) }));
    return false;
  }
}

function webhookUrl(): Promise<string | null> {
  webhookCache ??= (async () => {
    const name = process.env.CHAT_WEBHOOK_PARAMETER;
    if (!name) return null;
    try {
      const value = (await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }))).Parameter?.Value ?? "";
      return /^https:\/\//.test(value) ? value : null;
    } catch {
      return null; // not configured: chat notifications are off
    }
  })();
  return webhookCache;
}

/** Which chat the webhook belongs to (for the Reminder record), or null when off. */
export async function chatChannel(): Promise<"SLACK" | "TEAMS" | null> {
  const url = await webhookUrl();
  if (!url) return null;
  return new URL(url).hostname.endsWith("slack.com") ? "SLACK" : "TEAMS";
}

/** Posts a plain message to the chat channel. Returns null when chat notifications are off. */
export async function postToChat(text: string, link?: { url: string; label: string }): Promise<boolean | null> {
  const url = await webhookUrl();
  if (!url) return null;
  const message = link ? `${text}\n${link.label}: ${link.url}` : text;
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: message.slice(0, 3500) }), signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return true;
  } catch (error) {
    console.error(JSON.stringify({ fn: "notify", channel: "CHAT", error: error instanceof Error ? error.message : String(error) }));
    return false;
  }
}
