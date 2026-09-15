import { proxyMyAiRequest } from "@/lib/my-ai-proxy";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return proxyMyAiRequest("/health", request);
}
