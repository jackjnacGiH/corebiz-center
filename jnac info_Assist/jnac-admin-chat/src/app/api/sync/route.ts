import { syncSheetsToStorage } from "@/lib/sheet-sync";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const summary = await syncSheetsToStorage();
  return Response.json(summary);
}

export async function POST(request: Request) {
  return GET(request);
}
