import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Renderable, SyntaxStyle, TextAttributes } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { TuiApp, TuiMessage } from "../apps/tui/src/App.tsx";
import { appearanceColors, MoguriSdk, type PublicMessage } from "@moguri-dev/sdk";
import { tuiTabs } from "../apps/tui/src/commands.ts";
import { admitGeneratedSkill, reviewNativeTools, setupFixture, waitFor } from "./fixture.ts";
import { closeTui } from "./fixtures/tui-client.ts";
import { ciTime } from "./fixtures/time-scale.ts";

type Terminal = Awaited<ReturnType<typeof createTestRenderer>>;
async function frameUntil(setup: Terminal, text: string, check?: () => boolean) {
  const deadline = Date.now() + ciTime(8000);
  do {
    await new Promise((resolve) => setTimeout(resolve, 15));
    await setup.flush();
    if (setup.captureCharFrame().includes(text) && (!check || check())) return;
  } while (Date.now() < deadline);
  throw new Error(`Compact TUI did not show ${text}:\n${setup.captureCharFrame()}`);
}
async function paintWithin700ms(setup: Terminal, text: string, action: () => unknown, check?: () => boolean) {
  const began = performance.now();
  await action();
  await frameUntil(setup, text, check);
  const elapsed = performance.now() - began;
  assert.ok(elapsed <= 700, `TUI presentation took ${elapsed.toFixed(2)} ms; budget is 700 ms (${text}).`);
}
async function saveFrame(setup: Terminal, name: string) {
  const directory = process.env.MOGURI_TUI_SCREENSHOT_DIR;
  if (!directory) return;
  await setup.waitForVisualIdle();
  const { Resvg } = await import("@resvg/resvg-js");
  const frame = setup.captureSpans(), cell = 9, lineHeight = 19;
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const hex = (color: typeof frame.lines[number]["spans"][number]["fg"]) => "#" + color.toInts().slice(0, 3).map((part) => part.toString(16).padStart(2, "0")).join("");
  const rows = frame.lines.map((line, y) => {
    let column = 0;
    return line.spans.map((span) => {
      const x = column * cell, width = span.width * cell;
      column += span.width;
      return `<rect x="${x}" y="${y * lineHeight}" width="${width}" height="${lineHeight}" fill="${hex(span.bg)}"/><text x="${x}" y="${y * lineHeight + 14}" fill="${hex(span.fg)}" font-weight="${span.attributes & TextAttributes.BOLD ? "bold" : "normal"}" textLength="${width}" lengthAdjust="spacingAndGlyphs">${escape(span.text)}</text>`;
    }).join("");
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.cols * cell}" height="${frame.rows * lineHeight}"><g font-family="Menlo" font-size="14" xml:space="preserve">${rows}</g></svg>`;
  await mkdir(directory, { recursive: true });
  const png = new Resvg(svg, { font: { fontFiles: ["/System/Library/Fonts/Menlo.ttc"], loadSystemFonts: false, defaultFontFamily: "Menlo" } }).render().asPng();
  await writeFile(join(directory, `${name}.png`), png);
  await writeFile(join(directory, `${name}.txt`), setup.captureCharFrame());
}

test("the idle chat gives space to the conversation instead of navigation and input frames", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 120, height: 40, kittyKeyboard: true, useMouse: true, exitOnCtrlC: false });
  const root = createRoot(setup.renderer);
  try {
    await paintWithin700ms(setup, "Write a prompt", () => flushSync(() => root.render(createElement(TuiApp, { client: sdk }))));
    const navigation = setup.renderer.root.findDescendantById("tui-navigation");
    const input = setup.renderer.root.findDescendantById("tui-composer");
    assert.ok(navigation instanceof Renderable);
    assert.ok(input instanceof Renderable);
    assert.equal(navigation.height, 1, "all five tabs should occupy one terminal row");
    assert.ok(input.parent && input.parent.height <= 4, "an idle composer should not be a nine-row panel");
    assert.ok(!setup.captureCharFrame().includes("no checklist"), "missing plan data should not add a fake progress row");
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.session().draft.text, "");
  } finally { await closeTui(root, setup, sdk, () => fixture.close()); }
});

test("the actual TUI shows a named book indicator only after complete explicit skill loading", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 120, height: 40, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk }))); await frameUntil(setup, "Write a prompt");
    const source = join(fixture.directory, "generated-tui-book"); await mkdir(source);
    await writeFile(join(source, "SKILL.md"), "---\nname: generated-tui-book\ndescription: Generated exact TUI source\n---\nGenerated complete instructions.\n");
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, skillSources: [{ id: "generated-tui-book", name: "Generated TUI book", kind: "local", enabled: true, path: source }] }, settings.revision);
    const skill = (await sdk.skills.find("", { sessionId: fixture.sessionId })).skills[0]!;
    await sdk.skills.read(skill.id, skill.digest, fixture.sessionId);
    assert.equal(setup.captureCharFrame().includes("Loaded skill:"), false);
    await admitGeneratedSkill(sdk, fixture.sessionId, skill.id, skill.digest); await sdk.skills.consume(fixture.sessionId, skill.id, skill.digest);
    await frameUntil(setup, "Loaded skill: generated-tui-book");
    assert.ok(setup.captureCharFrame().includes("📖")); assert.equal(fixture.requests.length, 0);
  } finally { await closeTui(root, setup, sdk, () => fixture.close()); }
});

test("assistant prose renders Markdown instead of exposing formatting delimiters", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text", replyText: "## Generated review\n\nKeep **small controls** and `clear output`.\n\n- First generated point\n- Second generated point" });
  await fixture.configure();
  await fixture.send("Generated terminal typography request.");
  await fixture.terminal();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 120, height: 40, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    await paintWithin700ms(setup, "small controls", () => flushSync(() => root.render(createElement(TuiApp, { client: sdk }))));
    const frame = setup.captureCharFrame();
    assert.ok(!frame.includes("## Generated review"));
    assert.ok(!frame.includes("**small controls**"));
    assert.ok(!frame.includes("`clear output`"));
    assert.ok(!frame.includes("\u250c"), "ordinary conversation should not be wrapped in another bordered panel");
    assert.ok(frame.includes("Generated review"));
    assert.ok(frame.includes("First generated point"));
  } finally { await closeTui(root, setup, sdk, () => fixture.close()); }
});

test("the native composer grows with wrapped text and shrinks without replacing the draft on resize", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 120, height: 40, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk })));
    await frameUntil(setup, "Write a prompt");
    const input = setup.renderer.root.findDescendantById("tui-composer");
    assert.ok(input instanceof Renderable);
    const text = "Generated wrapped text. ".repeat(20) + "\nGenerated final line.";
    await paintWithin700ms(setup, "Generated final line.", async () => {
      await setup.mockInput.typeText(text);
      await waitFor(() => fixture.session().draft.text === text);
    });
    assert.ok(input.height > 2 && input.height <= 8);
    setup.resize(52, 24);
    await frameUntil(setup, "Generated");
    assert.equal(fixture.session().draft.text, text);
    assert.ok(input.x >= 0 && input.x + input.width <= 52);
    assert.ok(input.y >= 0 && input.y + input.height <= 24);
    setup.mockInput.pressKey("a", { super: true });
    await setup.mockInput.typeText("Generated shorter draft.");
    await waitFor(() => fixture.session().draft.text === "Generated shorter draft.");
    await setup.flush();
    assert.equal(input.height, 2);
    assert.equal(fixture.requests.length, 0);
  } finally { await closeTui(root, setup, sdk, () => fixture.close()); }
});

test("completed tool output stays compact until actual mouse or keyboard inspection without changing retained data", { skip: process.platform !== "darwin" }, async () => {
  const marker = "GENERATED_RAW_TOOL_BODY_";
  const fixture = await setupFixture({ modelId: "generated-ui-model", toolCall: { name: "read_file", args: { path: "fixture.txt" } },
    replyText: "## A little more room\n\nThe requested fixture operation is complete.\n\n- **Conversation first**, without boxed panels\n- Tool output stays one row until you inspect it\n- The input grows only when it needs to\n\n```typescript\nconst layout = \"compact\";\n```" });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  await writeFile(join(fixture.project, "fixture.txt"), marker.repeat(300));
  await reviewNativeTools(fixture, ["read_file"]);
  await fixture.configure();
  await fixture.send("Generated compact activity request.");
  const approval = await waitFor(() => fixture.session().pendingApproval);
  assert.equal(approval.call.name, "read_file");
  await sdk.approvals.respond(fixture.sessionId, approval.id, true);
  await fixture.terminal();
  const result = fixture.session().messages.find((message) => message.role === "tool")!;
  assert.ok(result.text.includes(marker));
  const original = result.text, calls = fixture.requests.length;
  const setup = await createTestRenderer({ width: 120, height: 40, kittyKeyboard: true, useMouse: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk })));
    await frameUntil(setup, "The requested fixture operation is complete.");
    await frameUntil(setup, 'const layout = "compact";');
    await sdk.sessions.rename(fixture.sessionId, "Compact TUI review");
    if (process.env.MOGURI_TUI_SCREENSHOT_DIR) {
      const original = fixture.session();
      for (const title of ["Review keyboard access", "Inspect generated fixtures", "Plan a small change", "New chat"]) {
        const created = await sdk.sessions.create(original.projectId, title);
        await sdk.sessions.rename(created.id!, title);
      }
    }
    await setup.flush();
    assert.ok(!setup.captureCharFrame().includes(marker));
    assert.ok(setup.captureCharFrame().includes("Read file / Completed  fixture.txt"), "tool rows use the shared activity label and subject");
    await saveFrame(setup, "chat-120x40");
    const target = setup.renderer.root.findDescendantById(`tui-tool-${result.id}`);
    assert.ok(target instanceof Renderable);
    await paintWithin700ms(setup, marker, () => setup.mockMouse.click(target.x + 2, target.y));
    await setup.mockMouse.click(target.x + 2, target.y);
    await setup.flush();
    assert.ok(!setup.captureCharFrame().includes(marker));
    await paintWithin700ms(setup, marker, () => setup.mockInput.pressKey("F2"));
    setup.mockInput.pressKey("F2");
    await setup.flush();
    assert.ok(!setup.captureCharFrame().includes(marker));
    assert.equal(fixture.session().messages.find((message) => message.id === result.id)?.text, original);
    assert.equal(fixture.requests.length, calls);
    assert.equal(fixture.session().draft.text, "");
    setup.resize(52, 24);
    await frameUntil(setup, 'const layout = "compact";');
    await saveFrame(setup, "chat-52x24");
  } finally { await closeTui(root, setup, sdk, () => fixture.close()); }
});

test("a compact approval leads with the shared label and command before its exact arguments", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ toolCall: { name: "run_command", args: { command: "printf GENERATED_COMPACT_SUBJECT", timeoutMs: 2000 } } });
  await fixture.configure(); await fixture.send("Generated compact approval request.");
  await waitFor(() => fixture.session().pendingApproval);
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 52, height: 24, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk })));
    await frameUntil(setup, "Approval required: run_command");
    await frameUntil(setup, "Run command: printf GENERATED_COMPACT_SUBJECT");
    assert.ok(setup.captureCharFrame().includes("Run command / Pending"));
    assert.ok(setup.captureCharFrame().includes("Ctrl+Y approve | Ctrl+D deny | Ctrl+V args"));
    assert.deepEqual(fixture.session().pendingApproval?.call.arguments, { command: "printf GENERATED_COMPACT_SUBJECT", timeoutMs: 2000 });
    assert.equal(fixture.requests.length, 1);
  } finally { await closeTui(root, setup, sdk, () => fixture.close()); }
});

test("compact chat keeps every navigation target and shared controls on screen from 52 to 200 columns", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 120, height: 40, kittyKeyboard: true, useMouse: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk })));
    for (const [width, height] of [[120, 40], [52, 24], [80, 24], [200, 55]] as const) {
      setup.resize(width, height);
      await frameUntil(setup, "Write a prompt");
      const transcript = setup.renderer.root.findDescendantById("tui-transcript");
      assert.ok(transcript instanceof Renderable);
      assert.ok(transcript.height >= height - 9, `${width}x${height}: conversation lost space to idle chrome`);
      for (const tab of tuiTabs) {
        const target = setup.renderer.root.findDescendantById(`tui-tab-${tab.id}`);
        assert.ok(target instanceof Renderable);
        assert.ok(target.x >= 0 && target.x + target.width <= width);
        assert.ok(target.y >= 0 && target.y + target.height <= height);
      }
      for (const id of ["tui-composer", "tui-status-env", "tui-status-budget"]) {
        const target = setup.renderer.root.findDescendantById(id);
        assert.ok(target instanceof Renderable);
        assert.ok(target.y >= 0 && target.y + target.height <= height);
      }
      assert.ok(setup.captureCharFrame().includes("Env Local"));
      assert.ok(setup.captureCharFrame().includes("Budget Unlimited"));
    }
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.session().draft.text, "");
  } finally { await closeTui(root, setup, sdk, () => fixture.close()); }
});

test("code fences and image/link labels remain text, without grammar downloads or native actions", { skip: process.platform !== "darwin" }, async () => {
  const reply = "## Generated code\n\n```generated-language\nconst compact = true;\n```\n\n[Generated link](https://never-fetch.invalid/review)\n\n![Generated image](https://never-fetch.invalid/image.png)";
  const fixture = await setupFixture({ responseMode: "text", replyText: reply });
  await fixture.configure(); await fixture.send("Generated safe Markdown request."); await fixture.terminal();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 120, height: 40, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  let nativeActions = 0;
  const reject = async () => { nativeActions++; throw new Error("Generated presentation cannot open an app or clipboard."); };
  const fetch = globalThis.fetch, unexpected: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith(sdk.connection.baseUrl + "/")) { unexpected.push(url); throw new Error("Generated terminal output cannot download external content."); }
    return fetch(input, init);
  };
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk, native: { browser: reject, file: reject, copy: reject } })));
    await frameUntil(setup, "const compact = true;");
    await frameUntil(setup, "Generated link");
    await setup.waitForVisualIdle();
    const frame = setup.captureCharFrame();
    assert.deepEqual(unexpected, [], "Markdown must not fetch unqualified external content");
    assert.ok(!frame.includes("```"));
    assert.ok(frame.includes("Generated link"), frame);
    assert.ok(frame.includes("Generated image"), frame);
    assert.equal(nativeActions, 0);
    assert.deepEqual(unexpected, []);
    assert.equal(fixture.session().messages.find((message) => message.role === "assistant")?.text, reply);
  } finally { globalThis.fetch = fetch; await closeTui(root, setup, sdk, () => fixture.close()); }
});

test("failed, stopped and unconfirmed results stay visible when ordinary tool output is folded", { skip: process.platform !== "darwin" }, async () => {
  const setup = await createTestRenderer({ width: 100, height: 28, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: "#e1e8f0" } }, setup.renderer.nativeScene);
  const messages: PublicMessage[] = [
    { id: "generated-partial", turnId: "generated-turn", role: "notice", outcome: "partial", timestamp: "2026-01-01T00:00:00.000Z",
      text: "Generated cleanup is unconfirmed. No original work was replayed.\x1b[2J" },
    { id: "generated-failed-request", turnId: "generated-turn", role: "assistant", outcome: "failed", timestamp: "2026-01-01T00:00:00.000Z", text: "",
      toolCalls: [{ id: "generated-settled-request", name: "command_job", arguments: { action: "start" } }] },
    ...["failed", "stopped", undefined].map((outcome, index): PublicMessage => ({
      id: `generated-tool-${index}`, turnId: "generated-turn", role: "tool", outcome, timestamp: "2026-01-01T00:00:00.000Z",
      text: `Generated ${outcome ?? "unknown"} outcome requires inspection.`,
      toolCalls: [{ id: `generated-call-${index}`, name: "command_job", arguments: { action: "start" } }],
    })),
  ];
  let inspection = 0;
  try {
    flushSync(() => root.render(createElement("box", { flexDirection: "column", width: "100%", height: "100%" },
      ...messages.map((message) => createElement(TuiMessage, { key: message.id, message, detailed: false, activeTurnId: null,
        settledToolCalls: new Set(["generated-settled-request"]), syntaxStyle, renderMarkdownNode: () => undefined, inspect: () => { inspection++; } })))));
    await frameUntil(setup, "Generated unknown outcome requires inspection.");
    const frame = setup.captureCharFrame();
    assert.ok(frame.includes("Session / Partial result"));
    assert.ok(frame.includes("Moguri / Failed"), "a failed tool-request message must not disappear behind a compact result row");
    assert.ok(frame.includes("Generated cleanup is unconfirmed"));
    assert.ok(frame.includes("Generated failed outcome requires inspection."));
    assert.ok(frame.includes("Generated stopped outcome requires inspection."));
    assert.ok(!frame.includes("\x1b"));
    assert.ok(messages[0]!.text.endsWith("\x1b[2J"), "only the rendered view may be sanitized");
    assert.equal(inspection, 0);
  } finally { flushSync(() => root.unmount()); syntaxStyle.destroy(); await setup.dispose(); }
});

test("keyboard history inspection preserves long message beginnings and unsent text, then explicitly follows latest", { skip: process.platform !== "darwin" }, async () => {
  const paragraphs = Array.from({ length: 70 }, (_, index) => `Generated paragraph ${String(index + 1).padStart(3, "0")}: ${"readable retained text ".repeat(4)}`);
  const fixture = await setupFixture({ responseMode: "text", maxOutputTokens: 8192, replyText: paragraphs.join("\n\n") });
  await fixture.configure(); await fixture.send("Generated long reading request."); await fixture.terminal();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 120, height: 40, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk })));
    await frameUntil(setup, "Generated paragraph 070");
    const transcript = setup.renderer.root.findDescendantById("tui-transcript");
    assert.ok(transcript instanceof Renderable && "scrollTop" in transcript && "scrollHeight" in transcript);
    await setup.mockInput.typeText("Generated unsent inspection draft.");
    await waitFor(() => fixture.session().draft.text === "Generated unsent inspection draft.");
    const calls = fixture.requests.length;
    for (let index = 0; index < 18; index++) setup.mockInput.pressKey("\x1b[5~");
    await frameUntil(setup, "Generated paragraph 001");
    assert.ok(setup.captureCharFrame().includes("F3 latest"));
    const beforePageDown = Number(transcript.scrollTop);
    setup.mockInput.pressKey("\x1b[6~");
    await setup.flush();
    assert.ok(Number(transcript.scrollTop) > beforePageDown);
    setup.mockInput.pressKey("F3");
    await frameUntil(setup, "Generated paragraph 070");
    assert.equal(fixture.session().draft.text, "Generated unsent inspection draft.");
    assert.equal(fixture.requests.length, calls);
    assert.equal(fixture.session().messages.find((message) => message.role === "assistant")?.text, paragraphs.join("\n\n"));
  } finally { await closeTui(root, setup, sdk, () => fixture.close()); }
});

test("formatted prose and plain code follow shared theme changes without stale native styles or extra inference", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text", replyText: "## Generated theme\n\n**Readable prose** stays visible.\n\n```generated-language\nconst theme = \"shared\";\n```" });
  await fixture.configure(); await fixture.send("Generated theme review."); await fixture.terminal();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  const setup = await createTestRenderer({ width: 120, height: 40, kittyKeyboard: true, exitOnCtrlC: false }), root = createRoot(setup.renderer);
  const calls = fixture.requests.length;
  try {
    flushSync(() => root.render(createElement(TuiApp, { client: sdk })));
    await frameUntil(setup, 'const theme = "shared";');
    for (const [palette, theme] of [["rose", "light"], ["moguri", "dark"]] as const) {
      const current = sdk.settings.get()!;
      const appearance = { ...current.values.appearance, palette, theme };
      const expected = appearanceColors(appearance, theme).accent.toLowerCase();
      await paintWithin700ms(setup, 'const theme = "shared";', () => sdk.settings.update({ ...current.values, appearance }, current.revision),
        () => setup.captureSpans().lines.some((line) => line.spans.some((span) =>
          span.text.includes("const theme") && "#" + span.fg.toInts().slice(0, 3).map((part) => part.toString(16).padStart(2, "0")).join("") === expected)));
      await frameUntil(setup, "Readable prose");
    }
    assert.equal(fixture.requests.length, calls);
    assert.equal(fixture.session().draft.text, "");
  } finally { await closeTui(root, setup, sdk, () => fixture.close()); }
});
