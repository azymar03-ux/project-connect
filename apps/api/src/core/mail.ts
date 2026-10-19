import nodemailer from "nodemailer";
import { db } from "./security";
import { deliverOutbox } from "./outbox";
export function startMailWorker() {
  if (!process.env.SMTP_URL) return;
  if (!process.env.MAIL_FROM)
    throw Error("MAIL_FROM is required for SMTP delivery");
  const u = new URL(process.env.SMTP_URL);
  if (!["smtp:", "smtps:"].includes(u.protocol))
    throw Error("Invalid SMTP protocol");
  const transport = nodemailer.createTransport({
    host: u.hostname,
    port: Number(u.port || (u.protocol === "smtps:" ? 465 : 587)),
    secure: u.protocol === "smtps:",
    auth: u.username
      ? {
          user: decodeURIComponent(u.username),
          pass: decodeURIComponent(u.password),
        }
      : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 60000,
  });
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await deliverOutbox(db, (row) =>
        transport
          .sendMail({
            from: process.env.MAIL_FROM,
            to: row.recipient,
            subject: row.subject,
            text: row.body,
            messageId: `<${row.id}@projectconnect.local>`,
          })
          .then(() => {}),
      );
    } catch {
      console.error(
        JSON.stringify({ level: "error", code: "MAIL_WORKER_FAILURE" }),
      );
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, 15000);
  timer.unref();
  void tick();
}
