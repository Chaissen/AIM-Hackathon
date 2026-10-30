import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { env } from "@/env";
import { appRouter } from "@/server/api/root";
import { createContextFromRequest } from "@/server/api/trpc";
import { withUploadLimit } from "@/server/api/upload-limit";

const noStore = { "Cache-Control": "private, no-store" };

async function handler(incoming: Request) {
  const req = await withUploadLimit(incoming);
  if (!req) return Response.json({ error: { message: "The upload is too large" } }, { status: 413, headers: noStore });
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createContextFromRequest(req),
    responseMeta: () => ({ headers: noStore }),
    onError:
      env.NODE_ENV === "development"
        ? ({ path, error }) => console.error(`tRPC failed on ${path ?? "<no-path>"}: ${error.message}`)
        : undefined,
  });
}

export { handler as GET, handler as POST };
