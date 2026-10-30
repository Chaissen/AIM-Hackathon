import { MAX_UPLOAD_BYTES } from "@/server/answers/submit";

// tRPC reads a body whole, so the route reads it first, up to a limit: for an upload the file limit plus the form
// fields, for anything else (the JSON of every other procedure) far less.
export const MAX_FORM_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;
export const MAX_JSON_BYTES = 64 * 1024;

const limitFor = (req: Request) => (req.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data") ? MAX_FORM_BYTES : MAX_JSON_BYTES);

/**
 * The request with its body read up to the limit for its content type, or null when it is larger. The body is counted
 * as it streams in, so a chunked request without Content-Length cannot get past the limit either. A request without a
 * body passes as it is.
 */
export async function withUploadLimit(req: Request, limit = limitFor(req)): Promise<Request | null> {
  if (!req.body) return req;
  if (Number(req.headers.get("content-length") ?? 0) > limit) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new Request(req.url, { method: req.method, headers: req.headers, body: new Uint8Array(Buffer.concat(chunks)), signal: req.signal });
}
