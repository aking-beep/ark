import { proxyMyAiRequest } from "@/lib/my-ai-proxy";

export const dynamic = "force-dynamic";

async function handle(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = new URL(request.url);
  return proxyMyAiRequest(`/v1/${path.join("/")}${url.search}`, request);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
