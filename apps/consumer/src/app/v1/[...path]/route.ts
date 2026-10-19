import { buildUpstreamPath, proxyMyAiRequest } from "@/lib/my-ai-proxy";

export const dynamic = "force-dynamic";

async function handle(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = new URL(request.url);
  const upstreamPath = buildUpstreamPath(path ?? [], url.search);
  if (!upstreamPath) {
    return Response.json({ error: "Invalid path." }, { status: 400 });
  }
  return proxyMyAiRequest(upstreamPath, request);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
