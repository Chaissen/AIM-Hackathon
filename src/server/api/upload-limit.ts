import { MAX_UPLOAD_BYTES } from "@/server/answers/submit";

// tRPC reads a FormData body whole, so an upload may be at most the file limit plus the form fields.
export const MAX_FORM_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;

/**
 * A multipart request with its body read up to `limit` bytes, or null when it is larger. The body is counted as it
 * streams in, so a chunked upload without Content-Length cannot get past the limit either. Other requests pass as they are.
 */
export async function withUploadLimit(req: Request, limit = MAX_FORM_BYTES): Promise<Request | null> {
  if (!req.headers.get("content-type")?.startsWith("multipart/form-data") || !req.body) return req;
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
