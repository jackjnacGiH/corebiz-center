import { requireAdminForApi } from "@/lib/auth";
import { saveChatTurn } from "@/lib/chat-store";
import { generateAdminAnswer } from "@/lib/openai";
import { buildRetrievalContext } from "@/lib/search";

export async function POST(request: Request) {
  const { session, response } = await requireAdminForApi();
  if (response) return response;

  const body = (await request.json()) as {
    message?: string;
    sessionId?: string | null;
  };
  const message = body.message?.trim();
  if (!message) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  const retrieval = await buildRetrievalContext(message);
  const answer = await generateAdminAnswer({
    question: message,
    contextText: retrieval.contextText,
  });
  const sessionId = await saveChatTurn({
    sessionId: body.sessionId,
    adminEmail: session!.email,
    question: message,
    answer,
    metadata: {
      product_codes: retrieval.products.map((product) => product.product_code),
      price_rule_ids: retrieval.priceRules.map((rule) => rule.id),
    },
  });

  return Response.json({
    sessionId,
    answer,
    products: retrieval.products.slice(0, 5),
    priceRules: retrieval.priceRules.slice(0, 5),
  });
}
