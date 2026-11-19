// Run through Obsidian CLI eval. Only this temporary note is changed.
(async () => {
	const pause = (ms = 180) => new Promise(resolve => setTimeout(resolve, ms));
	const assert = (ok, message) => { if (!ok) throw new Error(message); };
	const originalLeaf = app.workspace.activeLeaf;
	const settings = app.plugins.plugins["better-blockquote-editing"].settings;
	const originalBehavior = settings.backspaceBehavior;
	const file = await app.vault.create(`bbe-backspace-${Date.now()}.md`, "");
	const leaf = app.workspace.getLeaf("tab");
	const passed = [];
	try {
		settings.backspaceBehavior = "delete";
		require("electron").remote.getCurrentWindow().focus();
		await leaf.openFile(file, { state: { mode: "source", source: false } });
		app.workspace.setActiveLeaf(leaf, { focus: true });
		await pause(500);
		const view = leaf.view, cm = view.editor.cm;
		const root = () => cm.dom.querySelector(".bbe-inline-editor");
		const press = (target, key, options = {}) => target.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
			key, code: key, bubbles: true, cancelable: true, ...options,
		}));
		const mod = process.platform === "darwin" ? { metaKey: true } : { ctrlKey: true };
		const close = async () => { root()?.querySelector(":scope > .bbe-close").click(); await pause(); };
		const load = async (text, anchor) => {
			require("electron").remote.getCurrentWindow().focus();
			await close();
			cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: text }, selection: { anchor: text.length } });
			cm.focus(); await pause();
			cm.dispatch({ selection: { anchor } }); cm.focus(); await pause();
		};
		for (const block of ["> one", "> one\n> two", ">", "  > indented\n  > last",
			"> first\nlazy continuation", "> outer\n>\n> > inner\n>\n> last", "> ```\n> code\n> ```",
			"> [!note] Title\n> body\n> last", "> [!tip]- Folded\n> body", "> [!note]"]) {
			for (const prefix of ["", "before\n\n"]) {
				const text = prefix + block + "\n\nafter", anchor = prefix.length + block.length + 1;
				await load(text, anchor);
				const before = { selection: cm.state.selection.toJSON(), focus: cm.hasFocus, active: document.activeElement?.className,
					composing: cm.compositionStarted, readOnly: cm.state.readOnly, root: !!root(), state: view.getState() };
				press(cm, "Backspace"); await pause();
				assert(cm.state.doc.toString() === prefix + "\nafter", "did not delete the complete quote: " + JSON.stringify({ block, prefix, before, actual: cm.state.doc.toString() }));
				assert(cm.state.selection.main.head === prefix.length && !root(), "deletion moved the caret or opened an editor");
				press(cm, "z", mod); await pause();
				assert(cm.state.doc.toString() === text, "undo did not restore the complete quote");
				if (process.platform === "darwin") press(cm, "z", { ...mod, shiftKey: true });
				else press(cm, "y", mod);
				await pause();
				assert(cm.state.doc.toString() === prefix + "\nafter", "redo did not delete the complete quote: " + JSON.stringify({ text: cm.state.doc.toString(), selection: cm.state.selection.toJSON(), focus: cm.hasFocus, root: !!root() }));
			}
		}
		passed.push("Backspace after single-line, multiline, empty, indented, lazy and nested quotes deletes the whole block; undo and redo restore/delete it together");
		for (const text of ["> one\n\nafter", "> one\n\n\nafter", "```\n> code\n```\n\nafter", "- > listed\n\nafter"]) {
			const anchor = text.indexOf("after");
			await load(text, anchor);
			press(cm, "Backspace"); await pause();
			assert(cm.state.doc.toString() === text.slice(0, anchor - 1) + text.slice(anchor), "deleted a quote across a blank line, code fence or list: " + JSON.stringify({ text, actual: cm.state.doc.toString(), focus: cm.hasFocus }));
		}
		passed.push("blank-line gaps, fenced code and quotes inside lists keep ordinary Backspace behavior");
		const text = "before\n\n> one\n> two\n\nafter";
		const anchor = text.indexOf("\n\nafter") + 1;
		await load(text, anchor);
		cm.dispatch({ selection: { anchor, head: anchor + 1 } });
		press(cm, "Backspace"); await pause();
		assert(cm.state.doc.toString() === text.slice(0, anchor) + text.slice(anchor + 1), "a range selection deleted the whole quote");
		await load(text, anchor);
		const Selection = cm.state.selection.constructor;
		cm.dispatch({ selection: Selection.create([Selection.cursor(anchor), Selection.cursor(text.length)]) });
		press(cm, "Backspace"); await pause();
		assert(cm.state.doc.toString() === text.slice(0, anchor - 1) + text.slice(anchor, -1), "multiple carets deleted the whole quote");
		await load(text, anchor);
		cm.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
		try {
			press(cm, "Backspace");
			assert(cm.state.doc.toString().includes("> one\n> two"), "composition deleted the whole quote");
		} finally {
			cm.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
			await pause(300);
		}
		passed.push("range selections, multiple carets and IME do not trigger whole-quote deletion");
		await load(text, text.indexOf("one") + 2);
		assert(root(), "quote body editor missing: " + JSON.stringify({ text: cm.state.doc.toString(), selection: cm.state.selection.toJSON(), focus: cm.hasFocus, active: document.activeElement?.className }));
		const embedded = cm.constructor.findFromDOM(root().querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"));
		press(embedded, "Backspace"); await pause();
		assert(cm.state.doc.toString() === text.replace("one", "oe"), "Backspace inside the body removed the block");
		const callout = "before\n\n> [!note] Title\n> body\n> last\n\nafter";
		await load(callout, callout.indexOf("body"));
		const body = cm.constructor.findFromDOM(root().querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"));
		assert(body.hasFocus && body.state.selection.main.head === 0, "callout body start is not focused");
		const backwardInput = () => body.contentDOM.dispatchEvent(new InputEvent("beforeinput", {
			inputType: "deleteContentBackward", bubbles: true, cancelable: true,
		}));
		assert(!press(body, "Backspace") && !backwardInput(), "backward deletion was not canceled at the body start");
		await pause();
		assert(root() && body.hasFocus && body.state.selection.main.head === 0 &&
			cm.state.doc.toString() === callout, "Backspace at the body start moved the caret or changed the note");
		body.dispatch({ selection: { anchor: 0, head: 1 } });
		assert(backwardInput(), "beforeinput canceled deletion of selected body text");
		press(body, "Backspace"); await pause();
		assert(cm.state.doc.toString() === callout.replace("body", "ody"), "Backspace did not delete selected body text");
		passed.push("Backspace and beforeinput are canceled at the callout body start while selected text can still be deleted");
		const start = body.domAtPos(0), end = body.domAtPos(body.state.doc.length);
		body.contentDOM.ownerDocument.getSelection().setBaseAndExtent(start.node, start.offset, end.node, end.offset);
		assert(body.state.selection.main.empty && body.state.selection.main.head === 0,
			"CodeMirror already received the native range selection");
		assert(backwardInput(), "beforeinput canceled a native range selection before CodeMirror received it");
		press(body, "Backspace"); await pause();
		assert(body.state.doc.length === 0 && cm.state.doc.toString() === "before\n\n> [!note] Title\n\nafter",
			"Backspace did not delete the native range selection while preserving the callout and surrounding text");
		passed.push("a native range selected just before Backspace can delete the whole body without touching the callout header");
		await close();
		await view.setState({ ...view.getState(), mode: "source", source: true }, { history: false }); await pause();
		await load(text, anchor);
		press(cm, "Backspace"); await pause();
		assert(cm.state.doc.toString() === text.slice(0, anchor - 1) + text.slice(anchor), "Source mode deleted the whole quote");
		passed.push("body editing and Source mode keep ordinary character deletion");
		await view.setState({ ...view.getState(), mode: "source", source: false }, { history: false }); await pause();
		const nested = "> outer\n>\n> > inner\n> > last\n>\n> tail\n\nafter";
		await load(nested, nested.indexOf("outer") + 1);
		const outer = cm.constructor.findFromDOM(root().querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"));
		outer.dispatch({ selection: { anchor: outer.state.doc.toString().indexOf("\n\ntail") + 1 } });
		outer.focus(); await pause();
		press(outer, "Backspace"); await pause();
		assert(cm.state.doc.toString() === "> outer\n> \n> \n> tail\n\nafter", "nested deletion did not preserve and synchronize the enclosing quote: " + cm.state.doc.toString());
		passed.push("deleting an inner quote preserves its enclosing quote and synchronizes the note");
		return JSON.stringify({ passed });
	} catch (error) {
		throw new Error(`${error.stack}\nCompleted: ${JSON.stringify(passed)}`);
	} finally {
		settings.backspaceBehavior = originalBehavior;
		await leaf.view.save(); leaf.detach(); await pause();
		if (app.vault.getAbstractFileByPath(file.path) === file) await app.vault.delete(file);
		if (originalLeaf) app.workspace.setActiveLeaf(originalLeaf, { focus: true });
	}
})()
