import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { env } from "@/env";
import { appRouter } from "@/server/api/root";
import { createContextFromRequest } from "@/server/api/trpc";
import { MAX_UPLOAD_BYTES } from "@/server/answers/submit";

// tRPC reads a FormData body whole, so refuse an upload that announces more than the file limit plus the form fields.
const MAX_FORM_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;

const tooLarge = (req: Request) =>
  req.headers.get("content-type")?.startsWith("multipart/form-data") && Number(req.headers.get("content-length") ?? 0) > MAX_FORM_BYTES;

const handler = (req: Request) =>
  tooLarge(req)
    ? Response.json({ error: { message: "The upload is too large" } }, { status: 413, headers: { "Cache-Control": "private, no-store" } })
    : fetchRequestHandler({
        endpoint: "/api/trpc",
        req,
        router: appRouter,
        createContext: () => createContextFromRequest(req),
        responseMeta: () => ({ headers: { "Cache-Control": "private, no-store" } }),
        onError:
          env.NODE_ENV === "development"
            ? ({ path, error }) => console.error(`tRPC failed on ${path ?? "<no-path>"}: ${error.message}`)
            : undefined,
      });

export { handler as GET, handler as POST };
