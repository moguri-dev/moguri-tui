import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { TuiApp } from "../apps/tui/src/App.tsx";
import { setupFixture, waitFor } from "./fixture.ts";
import { generatedDocx, generatedPdf, generatedXlsx } from "./fixtures/documents.ts";
import { closeTui } from "./fixtures/tui-client.ts";

test("CLI attaches real documents and exposes bounded reads/searches through the same service", async () => {
  const fixture = await setupFixture();
  const cli = (...args: string[]) => promisify(execFile)(process.execPath, [resolve("dist/cli.mjs"), ...args, "--session", fixture.sessionId], {
    env: { ...process.env, MOGURI_STATE_DIR: join(fixture.directory, "state") }, timeout: 15_000, maxBuffer: 64 * 1024,
  });
  try {
    const path = join(fixture.directory, "generated-cli.xlsx"); await writeFile(path, generatedXlsx());
    const attached = JSON.parse((await cli("context", "document", path, "--capture-id", "generated-cli-capture")).stdout);
    const read = JSON.parse((await cli("context", "document-read", attached.id, "--filters", '{"sheet":"Generated sheet","range":"B1:C1","limit":1024}')).stdout);
    assert.equal(read.page.untrusted, true); assert.ok(Buffer.byteLength(read.page.text) <= 1024); assert.match(read.page.text, /"formula":"1\+2"/);
    const searched = JSON.parse((await cli("context", "document-search", attached.id, "--filters", '{"query":"WEBSERVICE","limit":2}')).stdout);
    assert.equal(searched.result.matches[0].location.cell, "D1");
    const java = join(fixture.directory, "GeneratedCli.java"); await writeFile(java, "class GeneratedCli {}\n");
    await cli("context", "file", java);
    assert.equal(fixture.session().draft.attachments.at(-1)?.kind, "local_file"); assert.equal(fixture.requests.length, 0);
  } finally { await fixture.close(); }
});

test("actual TUI keys attach all three document types, inspect bounded content and hold the complete context", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 180, height: 70, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const frameUntil = async (text: string) => {
    const deadline = Date.now() + 8000;
    do { await new Promise((resolve) => setTimeout(resolve, 15)); await setup.flush(); if (setup.captureCharFrame().includes(text)) return; } while (Date.now() < deadline);
    throw new Error(`Generated document TUI did not show ${text}:\n${setup.captureCharFrame()}`);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk }))); await frameUntil("Write a prompt");
    for (const [format, bytes] of [["docx", generatedDocx()], ["xlsx", generatedXlsx()], ["pdf", generatedPdf()]] as const) {
      const path = join(fixture.directory, `generated-tui.${format}`); await writeFile(path, bytes);
      await setup.mockInput.typeText(`/attach-document ${path}`); setup.mockInput.pressEnter();
      await waitFor(() => fixture.session().draft.attachments.some((attachment) => attachment.kind === "document" && attachment.format === format));
      await frameUntil(`${format.toUpperCase()} / ready`); await frameUntil("Captured attachment");
    }
    const attachment = fixture.session().draft.attachments.find((attachment) => attachment.kind === "document" && attachment.format === "docx")!;
    await setup.mockInput.typeText(`/document-read ${attachment.id} {"section":2,"limit":512}`); setup.mockInput.pressEnter();
    await frameUntil("GENERATED_DOCUMENT_SECRET"); await frameUntil('"paragraph": 2');
    setup.mockInput.pressEscape(); await frameUntil("Write a prompt");
    await setup.mockInput.typeText("Generated held document question."); setup.mockInput.pressEnter({ ctrl: true });
    await waitFor(() => fixture.session().queue[0]?.held);
    assert.equal(fixture.session().queue[0]?.attachments.length, 3); assert.equal(fixture.requests.length, 0);
  } finally { await closeTui(root, setup, sdk, fixture.close); }
});

test("browser SDK entrypoints do not bundle document parsers or Node runtime dependencies", async () => {
  for (const entry of ["packages/sdk/src/index.ts", "packages/sdk/src/react.ts"]) {
    const result = await build({ entryPoints: [entry], bundle: true, platform: "browser", format: "esm", write: false, metafile: true,
      external: ["react", "typebox", "typebox/value"] });
    assert.ok(Object.keys(result.metafile.inputs).every((path) => !/document-extract|document-worker|node_modules\/(?:pdfjs-dist|yauzl|sax)\//.test(path)));
    assert.doesNotMatch(result.outputFiles[0]!.text, /from ["']node:|import\(["']node:/);
  }
});
