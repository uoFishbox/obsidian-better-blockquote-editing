import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// Bundle the field and its CodeMirror runtime together so extension identities match.
const bundle = await build({ stdin: { contents: `
	export * from "./src/editing-state";
	export { EditorState } from "@codemirror/state";
`, resolveDir: process.cwd() }, bundle: true, format: "esm", platform: "node", write: false });
const { EditorState, editingField, startEditing, stopEditing, syncEditing, syncConflict } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`,
);

function fixture() {
	const doc = "before\n\n> body\n> last\n\nafter";
	const widget = { quote: { from: doc.indexOf(">"), to: doc.indexOf("\n\nafter") } };
	const state = EditorState.create({ doc, extensions: [editingField] })
		.update({ effects: startEditing.of(widget) }).state;
	return { state, widget };
}

test("editing tracks edits before the block without changing its content", () => {
	const { state, widget } = fixture();
	const updated = state.update({ changes: { from: 0, insert: "prefix\n" } }).state;
	const current = updated.field(editingField);
	assert.equal(current.widget, widget);
	assert.equal(current.from, widget.quote.from + 7);
	assert.equal(current.to, widget.quote.to + 7);
	assert.equal(current.valid, true);
	assert.equal(updated.sliceDoc(current.from, current.to), "> body\n> last");
});

test("source changes within a block reparse its range and retain its widget", () => {
	const { state, widget } = fixture();
	const from = state.doc.toString().indexOf("body");
	const updated = state.update({ changes: { from, to: from + 4, insert: "new\n> line" } }).state;
	const current = updated.field(editingField);
	assert.equal(current.widget, widget);
	assert.equal(current.valid, true);
	assert.equal(updated.sliceDoc(current.from, current.to), "> new\n> line\n> last");
});

test("deleted quotes invalidate the source but keep the widget available for draft recovery", () => {
	const { state, widget } = fixture();
	const updated = state.update({ changes: { from: widget.quote.from, to: widget.quote.to } }).state;
	const current = updated.field(editingField);
	assert.equal(current.valid, false);
	assert.equal(current.widget, widget);
	assert.equal(current.from, current.to);
	assert.equal(current.decorations.size, 1);
});

test("sync effects set the new range after a local replacement", () => {
	const { state, widget } = fixture();
	const insert = "> longer body\n> last\n> added";
	const updated = state.update({ changes: { from: widget.quote.from, to: widget.quote.to, insert },
		effects: syncEditing.of({ widget, length: insert.length }) }).state;
	const current = updated.field(editingField);
	assert.equal(current.from, widget.quote.from);
	assert.equal(current.to, current.from + insert.length);
	assert.equal(current.valid, true);
	assert.equal(updated.sliceDoc(current.from, current.to), insert);
});

test("effects only close, resize or flag their own editing session", () => {
	const { state, widget } = fixture();
	const other = { quote: widget.quote };
	const unchanged = state.update({ effects: [stopEditing.of(other), syncConflict.of(other),
		syncEditing.of({ widget: other, length: 0 })] }).state;
	assert.equal(unchanged.field(editingField), state.field(editingField));
	const conflicted = state.update({ effects: syncConflict.of(widget) }).state;
	assert.equal(conflicted.field(editingField).conflict, true);
	assert.equal(conflicted.update({ effects: stopEditing.of(widget) }).state.field(editingField), null);
});
