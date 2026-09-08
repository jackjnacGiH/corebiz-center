// Deliberately fail closed: the supplied spec defines no verifiable sender contract.
// Do not accept unsigned payloads or assume merchant HMAC authenticates callbacks.
Deno.serve(
  () =>
    new Response(JSON.stringify({ error: "webhook_contract_unconfirmed" }), {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    }),
);
