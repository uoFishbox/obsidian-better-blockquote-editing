import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { ChangeSet, Text } from "@codemirror/state";

const bundle = await build({ entryPoints: ["src/sync.ts"], bundle: true,
	format: "esm", platform: "node", write: false });
const { textChanges, changesOverlap, mergePendingText } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const text = value => Text.of(value.split("\n"));

test("minimal text changes handle insertion, deletion, replacement and Unicode", () => {
	for (const [before, after] of [["abc", "abc"], ["abc", ""], ["", "日本語"], ["ab\ncd", "ab\nnew\ncd"], ["日本語", "日英語"]]) {
		assert.equal(textChanges(before, after).apply(text(before)).toString(), after);
	}
});

test("disjoint pending and remote edits retain both results", () => {
	const base = "first\nlast";
	const local = textChanges(base, "local first\nlast");
	const remote = textChanges(base, "first\nremote last");
	assert.equal(changesOverlap(local, remote), false);
	assert.equal(remote.map(local, true).apply(local.apply(text(base))).toString(), "local first\nremote last");
	assert.equal(local.map(remote).apply(remote.apply(text(base))).toString(), "local first\nremote last");
});

test("same-point inserts coexist while overlapping replacements are protected", () => {
	const local = textChanges("body", "local body");
	const remote = textChanges("body", "remote body");
	assert.equal(changesOverlap(local, remote), false);
	assert.equal(remote.map(local, true).apply(local.apply(text("body"))).toString(), "remote local body");
	assert.equal(changesOverlap(textChanges("body", "one"), textChanges("body", "two")), true);
	assert.equal(changesOverlap(textChanges("body", "bXody"), textChanges("body", "new")), true);
});

test("merging keeps incoming changes and pending edits in their respective coordinates", () => {
	const base = "first\nlast";
	const local = "local first\nlast";
	const remote = "first\nremote last";
	const merged = mergePendingText(base, local, textChanges(base, local), remote);
	assert.ok(merged);
	assert.equal(merged.value, "local first\nremote last");
	assert.equal(merged.incoming.apply(text(local)).toString(), merged.value);
	assert.equal(merged.pending.apply(text(remote)).toString(), merged.value);
});

test("merging acknowledges identical replacements without duplicating the edit", () => {
	const base = "body", local = "日本語の本文";
	const merged = mergePendingText(base, local, textChanges(base, local), local);
	assert.equal(merged.value, local);
	assert.equal(merged.pending.empty, true);
	assert.equal(merged.incoming.empty, true);
});

test("conflicts preserve pending text, while shared insertions have deterministic order", () => {
	const pending = textChanges("body", "local");
	const snapshot = pending.toJSON();
	assert.equal(mergePendingText("body", "local", pending, "remote"), null);
	assert.deepEqual(pending.toJSON(), snapshot);
	assert.equal(pending.apply(text("body")).toString(), "local");
	const merged = mergePendingText("body", "local body", textChanges("body", "local body"), "remote body");
	assert.equal(merged.value, "remote local body");
	assert.equal(merged.pending.apply(text("remote body")).toString(), merged.value);
});

test("successive source updates rebase composed edits without changing earlier merge plans", () => {
	const base = "one\ntwo\nthree";
	const first = ChangeSet.of({ from: 0, insert: "日本語 " }, base.length);
	const intermediate = first.apply(text(base)).toString();
	const second = ChangeSet.of({ from: intermediate.length, insert: "!" }, intermediate.length);
	const pending = first.compose(second);
	const local = pending.apply(text(base)).toString();
	const remote = "one\nremote two\nthree";
	const merged = mergePendingText(base, local, pending, remote);
	const nextRemote = remote.replace("remote", "changed");
	const next = mergePendingText(remote, merged.value, merged.pending, nextRemote);
	assert.equal(next.value, "日本語 one\nchanged two\nthree!");
	assert.equal(next.incoming.apply(text(merged.value)).toString(), next.value);
	assert.equal(next.pending.apply(text(nextRemote)).toString(), next.value);
	assert.equal(merged.value, "日本語 one\nremote two\nthree!");
});

test("merging handles source-only, local-only, deletion and empty text", () => {
	for (const [base, local, remote, expected] of [
		["", "", "日本語", "日本語"],
		["body", "", "body", ""],
		["body", "body", "", ""],
		["body", "body!", "body", "body!"],
		["body", "body", "body", "body"],
	]) {
		const merged = mergePendingText(base, local, textChanges(base, local), remote);
		assert.ok(merged);
		assert.equal(merged.value, expected);
		assert.equal(merged.incoming.apply(text(local)).toString(), expected);
		assert.equal(merged.pending.apply(text(remote)).toString(), expected);
	}
});
