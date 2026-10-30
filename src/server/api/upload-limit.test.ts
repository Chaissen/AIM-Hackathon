import assert from "node:assert/strict";
import { test } from "node:test";

import { withUploadLimit } from "./upload-limit";

const multipart = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/trpc/portal.answer", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=x", ...headers },
    body,
    duplex: "half",
  } as RequestInit);

/** A body that streams in chunks and announces no length, as a chunked upload does. */
const chunked = (chunks: number, size: number) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < chunks; i++) controller.enqueue(new Uint8Array(size));
      controller.close();
    },
  });

test("an upload within the limit passes with its body", async () => {
  const req = await withUploadLimit(multipart("x".repeat(100)), 1000);
  assert.equal(await req?.text(), "x".repeat(100));
  assert.equal(req?.headers.get("content-type"), "multipart/form-data; boundary=x");
});

test("an upload over the limit is refused, by its Content-Length or by counting a chunked body", async () => {
  assert.equal(await withUploadLimit(multipart("x", { "content-length": "5000" }), 1000), null);
  assert.equal(await withUploadLimit(multipart(chunked(5, 300)), 1000), null);
  assert.ok(await withUploadLimit(multipart(chunked(3, 300)), 1000));
});

test("other requests pass untouched", async () => {
  const json = new Request("http://localhost/api/trpc/request.list", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
  assert.equal(await withUploadLimit(json, 1), json);
});
