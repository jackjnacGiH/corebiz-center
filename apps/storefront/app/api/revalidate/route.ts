import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

// Low-risk token (only triggers cache regeneration — no data access/mutation).
// Override via the REVALIDATE_SECRET env var on the Vercel "shop" service.
const SECRET = process.env.REVALIDATE_SECRET ?? "corebiz_shop_revalidate_2026";

function handle(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret") ?? req.headers.get("x-revalidate-secret");
  if (secret !== SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  // Revalidate the whole /shop subtree so product / group / category / home
  // pages pick up the latest data from คลังสินค้า on the next request.
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true, revalidated: true });
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}
