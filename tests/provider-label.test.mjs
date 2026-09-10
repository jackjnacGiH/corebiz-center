import test from "node:test";
import assert from "node:assert/strict";
import { providerLabelResource } from "../frontend/src/lib/provider-label.ts";

test("provider PDF data becomes a browser-safe PDF blob", async () => {
  const source = "%PDF-1.4\nlabel\n%%EOF";
  const resource = providerLabelResource(
    `data:application/pdf;base64,${Buffer.from(source).toString("base64")}`,
  );
  assert.equal(resource.kind, "pdf");
  assert.equal(resource.blob.type, "application/pdf");
  assert.equal(await resource.blob.text(), source);
});

test("provider label UI accepts HTTPS and rejects active or malformed content", () => {
  assert.deepEqual(providerLabelResource("https://labels.example.test/a.pdf"), {
    kind: "external",
    href: "https://labels.example.test/a.pdf",
  });
  for (const link of [
    "http://labels.example.test/a.pdf",
    "data:text/html;base64,PHNjcmlwdD4=",
    `data:application/pdf;base64,${Buffer.from("not a PDF").toString("base64")}`,
    `data:application/pdf;base64,JVBERi0${"A".repeat(1_900_001)}`,
  ]) assert.throws(() => providerLabelResource(link), /provider_response_invalid/);
});
