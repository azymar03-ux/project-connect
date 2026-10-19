// Runtime configuration validator
export function validateRuntimeConfig(env: NodeJS.ProcessEnv = process.env) {
  for (const name of [
    "AI_DAILY_LIMIT",
    "GOOGLE_PLACES_DAILY_LIMIT",
  ]) {
    const value = env[name];
    if (
      value !== undefined &&
      (!/^\d+$/.test(value) ||
        !Number.isSafeInteger(Number(value)) ||
        Number(value) < 1 ||
        Number(value) > 1000000000)
    )
      throw Error("Invalid positive integer setting: " + name);
  }
}
