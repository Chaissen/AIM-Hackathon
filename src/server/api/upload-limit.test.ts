import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_JSON_BYTES, withUploadLimit } from "./upload-limit";

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

const json = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/trpc/request.cancel", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
    duplex: "half",
  } as RequestInit);

test("every other body has its own, smaller limit", async () => {
  assert.equal(await (await withUploadLimit(json('{"id":1}')))?.text(), '{"id":1}');
  assert.equal(await withUploadLimit(json("x".repeat(MAX_JSON_BYTES + 1))), null);
  assert.equal(await withUploadLimit(json(chunked(2, MAX_JSON_BYTES))), null, "counted without Content-Length too");
  assert.ok(await withUploadLimit(multipart("x".repeat(MAX_JSON_BYTES + 1))), "an upload gets the upload limit");
});

test("a request without a body passes untouched", async () => {
  const get = new Request("http://localhost/api/trpc/health.status");
  assert.equal(await withUploadLimit(get), get);
});
