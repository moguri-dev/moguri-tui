import assert from "node:assert/strict";
import test from "node:test";
import { join, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import * as pty from "node-pty";
import { setupFixture, waitFor } from "./fixture.ts";

test("the built native TUI process actually exits cleanly for exit, /exit and raw Ctrl+C", { skip: process.platform !== "darwin" }, async (t) => {
  for (const action of ["exit", "/exit", "ctrl-c"] as const) await t.test(action, async () => {
    const fixture = await setupFixture(), exited = Promise.withResolvers<{ exitCode: number; signal?: number }>();
    let output = "", finished = false;
    const child = pty.spawn(process.execPath, [resolve("dist/tui.mjs")], { cwd: process.cwd(), cols: 120, rows: 40, name: "xterm-256color",
      env: { ...process.env, TERM: "xterm-256color", MOGURI_STATE_DIR: join(fixture.directory, "state") } });
    const data = child.onData((chunk) => { output = (output + chunk).slice(-131072); });
    const ending = child.onExit((value) => { finished = true; exited.resolve(value); });
    try {
      await waitFor(() => stripVTControlCharacters(output).includes("Write a prompt"), 8000);
      child.write(action === "ctrl-c" ? "\x03" : `${action}\r`);
      await waitFor(() => finished, 5000);
      const result = await exited.promise;
      assert.equal(result.exitCode, 0); assert.equal(fixture.requests.length, 0);
      assert.equal(fixture.session().queue.length, 0); assert.equal(fixture.session().messages.length, 0);
      assert.equal(fixture.session().draft.text, action === "ctrl-c" ? "" : action);
    } finally {
      if (!finished) { child.kill("SIGTERM"); await exited.promise; }
      data.dispose(); ending.dispose(); await fixture.close();
    }
  });
});
