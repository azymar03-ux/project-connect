// Owner-approved conservative input/output price ceiling, not a fetched vendor price.
// Rates: USD per million tokens expressed as integer microUSD per million tokens.
export function reservationMicroUsd(tokens: number, env = process.env) {
  if (!env.OPENAI_API_KEY) return 0n;
  const rate = Number(env.AI_MAX_TOKEN_PRICE_MICROUSD_PER_MILLION || 10000000);
  if (
    !Number.isSafeInteger(rate) ||
    rate < 1 ||
    !Number.isSafeInteger(tokens) ||
    tokens < 0
  )
    throw Error("INVALID_AI_PRICE");
  return (BigInt(tokens) * BigInt(rate) + 999999n) / 1000000n;
}
