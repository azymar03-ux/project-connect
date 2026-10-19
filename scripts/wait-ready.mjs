const deadline = Date.now() + 60000;
while (Date.now() < deadline) {
  try {
    const r = await fetch(
      process.env.READY_URL || "http://localhost:3000/api/ready",
    );
    if (r.ok) {
      console.log("Web proxy and database ready");
      process.exit(0);
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 1000));
}
console.error("Server readiness timed out");
process.exit(1);
