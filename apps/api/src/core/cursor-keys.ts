import { randomBytes } from "node:crypto";

const fallback = new Map<string, string>();
const names = ["CHAT_POSITION_SECRET", "EXPORT_CURSOR_SECRET"] as const;

export function cursorKeys(name: (typeof names)[number]) {
  const current = process.env[name];
  const previous = process.env[name + "_PREVIOUS"];

  if (!fallback.has(name)) {
    fallback.set(name, randomBytes(32).toString("hex"));
  }

  return [current || fallback.get(name)!, ...(previous ? [previous] : [])];
}

export function validateCursorKeys() {
  for (const name of names) {
    cursorKeys(name);
  }
}
