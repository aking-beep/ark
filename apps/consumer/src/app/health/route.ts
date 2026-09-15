import { proxyFitRequest } from "@/lib/fit-proxy";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return proxyFitRequest("/health", request);
}
