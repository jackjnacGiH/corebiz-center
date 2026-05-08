import { requireAdminForApi } from "@/lib/auth";
import { searchPriceRules, searchProducts } from "@/lib/search";

export async function GET(request: Request) {
  const { response } = await requireAdminForApi();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim();
  if (!query) {
    return Response.json({ products: [], priceRules: [] });
  }

  const [products, priceRules] = await Promise.all([
    searchProducts(query, 20),
    searchPriceRules(query, 20),
  ]);

  return Response.json({ products, priceRules });
}
