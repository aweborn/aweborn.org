/**
 * Aweborn: outgoing email (sign-in codes, verification, password reset).
 *
 * Sent with Amazon SES from a real, welcoming address that people can reply
 * to (hello@aweborn.org, forwarded to a human; see infra/cloudformation-mail.yml).
 * Never a no-reply address.
 *
 * Transport:
 *   - SES when AWS credentials are present (prod: a send-only IAM user whose
 *     key lives in the aweborn-secrets k8s secret).
 *   - Console in development (MAIL_TRANSPORT=console, or no credentials
 *     outside production), so the whole flow can be tested locally.
 *   - Off otherwise: the email sign-in methods are simply not offered.
 */

import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

const IS_PROD = process.env.NODE_ENV === "production";
const HAS_AWS_KEY = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
const TRANSPORT: "ses" | "console" | "off" =
  process.env.MAIL_TRANSPORT === "console"
    ? "console"
    : HAS_AWS_KEY
      ? "ses"
      : IS_PROD
        ? "off"
        : "console";

const FROM = process.env.MAIL_FROM ?? "Aweborn <hello@aweborn.org>";
const SITE = "https://aweborn.org";

let ses: SESv2Client | null = null;

export const emailEnabled = TRANSPORT !== "off";

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Send one email. Never throws: auth flows must not fail on mail hiccups. */
export async function sendEmail(mail: Email): Promise<void> {
  try {
    if (TRANSPORT === "console") {
      console.log(`[mail] (console) to=${mail.to} subject="${mail.subject}"\n${mail.text}`);
      return;
    }
    if (TRANSPORT === "off") return;
    ses ??= new SESv2Client({ region: process.env.AWS_REGION ?? "us-east-1" });
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: FROM,
        ReplyToAddresses: [FROM],
        Destination: { ToAddresses: [mail.to] },
        Content: {
          Simple: {
            Subject: { Data: mail.subject, Charset: "UTF-8" },
            Body: {
              Text: { Data: mail.text, Charset: "UTF-8" },
              Html: { Data: mail.html, Charset: "UTF-8" },
            },
          },
        },
      }),
    );
  } catch (err) {
    // Log the failure, never the recipient's full address or the code.
    console.error(`[mail] send failed (${mail.to.replace(/^(.).*@/, "$1…@")}):`, err);
  }
}

// ── Templates ───────────────────────────────────────────────────────────────

export type CodePurpose = "sign-in" | "email-verification" | "forget-password" | "change-email";

const CODE_COPY: Record<CodePurpose, { subject: string; lead: string; after: string }> = {
  "sign-in": {
    subject: "Your Aweborn code",
    lead: "Here's your code to save your player and sign in.",
    after: "Type it into Aweborn on the screen where you asked for it.",
  },
  "email-verification": {
    subject: "Confirm your email for Aweborn",
    lead: "Welcome! Here's your code to confirm this email and save your player.",
    after: "Type it into Aweborn on the screen where you signed up.",
  },
  "forget-password": {
    subject: "Your Aweborn password reset code",
    lead: "Here's your code to choose a new password.",
    after: "Type it into Aweborn, then pick your new password.",
  },
  "change-email": {
    subject: "Confirm your new email for Aweborn",
    lead: "Here's your code to confirm this as your new email.",
    after: "Type it into Aweborn to finish the change.",
  },
};

const spaced = (code: string) => (code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code);

export function codeEmail(to: string, code: string, purpose: CodePurpose, minutes: number): Email {
  const copy = CODE_COPY[purpose];
  const subject = `${copy.subject}: ${spaced(code)}`;
  const text = [
    "Hi there,",
    "",
    copy.lead,
    "",
    `    ${spaced(code)}`,
    "",
    `${copy.after} It works for ${minutes} minutes.`,
    "",
    "Didn't ask for this? You can safely ignore it. Nothing changes until the code is used.",
    "",
    "Questions, ideas, or just want to say hi? Reply to this email. A real person reads every one.",
    "",
    "With awe,",
    "Aweborn",
    SITE,
  ].join("\n");

  return { to, subject, text, html: layout(subject, `
    <p style="margin:0 0 16px">Hi there,</p>
    <p style="margin:0 0 24px">${copy.lead}</p>
    <div style="margin:0 0 24px;padding:20px 12px;text-align:center;border-radius:14px;background:#14123d;border:1px solid #3a3470">
      <div style="font:700 34px/1.2 'SFMono-Regular',Menlo,Consolas,monospace;letter-spacing:8px;color:#f0d78c">${spaced(code)}</div>
    </div>
    <p style="margin:0 0 16px">${copy.after} It works for ${minutes} minutes.</p>
    <p style="margin:0 0 16px;color:#a9abc4">Didn't ask for this? You can safely ignore it. Nothing changes until the code is used.</p>
  `) };
}

/** Sent to an existing player when someone tries to sign up with their email. */
export function existingAccountEmail(to: string): Email {
  const subject = "Someone tried to sign up to Aweborn with your email";
  const text = [
    "Hi there,",
    "",
    "Someone just tried to create an Aweborn player with this email, but you already have one.",
    "",
    "If it was you: no need to sign up again. Open Aweborn, choose \"Save your player\", and use \"Email me a code\" to sign in.",
    "",
    "If it wasn't you: you don't need to do anything. Your player is safe.",
    "",
    "Reply to this email if anything looks off. A real person reads every one.",
    "",
    "With awe,",
    "Aweborn",
    SITE,
  ].join("\n");
  return { to, subject, text, html: layout(subject, `
    <p style="margin:0 0 16px">Hi there,</p>
    <p style="margin:0 0 16px">Someone just tried to create an Aweborn player with this email, but you already have one.</p>
    <p style="margin:0 0 16px"><strong style="color:#eef0f6">If it was you:</strong> no need to sign up again. Open Aweborn, choose “Save your player”, and use “Email me a code” to sign in.</p>
    <p style="margin:0 0 16px"><strong style="color:#eef0f6">If it wasn't you:</strong> you don't need to do anything. Your player is safe.</p>
  `) };
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#050510">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050510;background-image:radial-gradient(ellipse at 20% 0%,#2a1850 0%,#050510 60%)">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px">
        <tr><td style="padding:0 4px 20px;font:600 20px/1 'Outfit','Segoe UI',Helvetica,Arial,sans-serif;letter-spacing:.5px;color:#eef0f6">
          <img src="${SITE}/icon-48.png" width="28" height="28" alt="" style="vertical-align:middle;margin-right:8px;border:0">Aweborn
        </td></tr>
        <tr><td style="padding:28px 24px;border-radius:18px;background:#0d0c2b;border:1px solid #23214f;font:400 16px/1.6 'Inter','Segoe UI',Helvetica,Arial,sans-serif;color:#c9cbe0">
          ${body}
          <p style="margin:24px 0 0">Questions, ideas, or just want to say hi? Reply to this email. A real person reads every one.</p>
          <p style="margin:16px 0 0">With awe,<br><span style="color:#f0d78c">Aweborn</span></p>
        </td></tr>
        <tr><td style="padding:20px 4px 0;font:400 12px/1.6 'Inter',Helvetica,Arial,sans-serif;color:#6d6f8c">
          Aweborn is a non-profit shared cosmos. <a href="${SITE}" style="color:#a9abc4">aweborn.org</a> · <a href="${SITE}/privacy.html" style="color:#a9abc4">Privacy</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
