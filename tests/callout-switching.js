// Run through Obsidian CLI eval. Only this temporary note is changed.
(async () => {
	const pause = (ms = 150) => new Promise(resolve => setTimeout(resolve, ms));
	const assert = (ok, message) => { if (!ok) throw new Error(message); };
	const originalLeaf = app.workspace.activeLeaf;
	const file = await app.vault.create(`bbe-callout-switching-${Date.now()}.md`, "");
	const leaf = app.workspace.getLeaf("tab");
	const passed = [];
	try {
		require("electron").remote.getCurrentWindow().focus();
		await leaf.openFile(file, { state: { mode: "source", source: false } });
		await pause(250);
		const cm = leaf.view.editor.cm;
		const root = () => cm.dom.querySelector(".bbe-inline-editor");
		const editorAt = selector => cm.constructor.findFromDOM(root().querySelector(selector));
		const body = () => editorAt(".bbe-editor-host > .markdown-source-view > .cm-editor");
		const title = () => editorAt(".bbe-title-host .cm-editor");
		const target = (type, part = "body") => cm.dom.querySelector(`.cm-callout .callout[data-callout="${type}"]`)
			?.closest(".cm-callout").querySelector(part === "body" ? ".callout-content p" :
				part === "title" ? ".callout-title-inner" : ".edit-block-button");
		const base = "> [!note] Alpha\n> first\n\nseparator\n\n> [!tip] Beta\n> second";
		const open = async (text = base, needle = "first") => {
			if (root()) { root().querySelector(":scope > .bbe-close").click(); await pause(); }
			cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: text }, selection: { anchor: text.indexOf("separator") } });
			cm.focus();
			await pause();
			cm.dispatch({ selection: { anchor: text.indexOf(needle) + 1 } });
			await pause(250);
			assert(root() && body().hasFocus, "initial editor did not open: " + JSON.stringify({
				selection: cm.state.selection.toJSON(), focus: cm.hasFocus, html: root()?.outerHTML.slice(0, 500)
			}));
		};
		const assertSwitched = (previous, part, expectedBody, expectedTitle) => {
			assert(root() !== previous && !previous.isConnected && cm.dom.querySelectorAll(".bbe-inline-editor").length === 1,
				"switch did not replace the previous editor");
			const focused = part === "title" ? title() : body();
			assert(body().state.doc.toString() === expectedBody && title().state.doc.toString() === expectedTitle,
				"switch opened the wrong callout");
			assert(focused.hasFocus && focused.state.selection.main.empty &&
				focused.state.selection.main.head === (part === "title" ? focused.state.doc.length : 0),
				"switch focused the wrong editor or cursor position");
			assert(cm.state.selection.main.empty && app.workspace.activeEditor?.editor?.cm === focused,
				"switch retained whole-block selection or the old command target");
		};

		for (const forward of [true, false]) {
			for (const part of ["body", "title", "button"]) {
				const oldBody = forward ? "first" : "second", oldTitle = forward ? "Alpha" : "Beta";
				await open(base, oldBody);
				const previous = root(), oldEditor = body(), next = target(forward ? "tip" : "note", part);
				assert(next, "destination target missing");
				// A selection in the old editor must not suppress a click in another callout.
				oldEditor.dispatch({ selection: { anchor: 0, head: 2 } });
				await pause();
				// Click before queued synchronization so both drafts must be flushed now.
				oldEditor.dispatch({ changes: { from: oldEditor.state.doc.length, insert: "\nappended" } });
				title().dispatch({ changes: { from: title().state.doc.length, insert: " updated" } });
				next.click();
				await pause(300);
				assertSwitched(previous, part, forward ? "second" : "first", forward ? "Beta" : "Alpha");
				assert(cm.state.doc.toString() === base.replace(oldBody, `${oldBody}\n> appended`).replace(oldTitle, `${oldTitle} updated`),
					"switch lost pending input, moved the destination incorrectly or inserted outside lines");
			}
		}
		passed.push("body, title and edit-button clicks switch in both directions, flushing pending title/body edits and replacing the old selection");

		for (const pointerType of ["mouse", "touch", "pen"]) {
			await open();
			const previous = root(), next = target("tip", "title");
			const options = { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true, pointerType };
			next.dispatchEvent(new PointerEvent("pointerdown", options));
			const from = base.indexOf("> [!tip]"), to = base.length;
			cm.dispatch({ selection: pointerType === "mouse" ? { anchor: to, head: from } : { anchor: from } });
			await pause(30);
			(next.isConnected ? next : cm.contentDOM).dispatchEvent(new PointerEvent("pointerup", options));
			await pause(30);
			(next.isConnected ? next : cm.contentDOM).dispatchEvent(new MouseEvent("click", options));
			await pause(300);
			assertSwitched(previous, "title", "second", "Beta");
			assert(cm.state.doc.toString() === base, "native selection switch changed the source");
		}
		passed.push("mouse, touch and pen native selections switch to the clicked title even when click arrives after DOM replacement");

		await open();
		{
			const previous = root(), embedded = body(), next = target("tip");
			embedded.dispatch({ changes: { from: 0, to: 5, insert: "local draft" } });
			const at = cm.state.doc.toString().indexOf("first");
			cm.dispatch({ changes: { from: at, to: at + 5, insert: "remote" } });
			next.click();
			await pause(300);
			assert(root() === previous && embedded.dom.isConnected && embedded.state.doc.toString() === "local draft" &&
				root().querySelector(".bbe-conflict") && cm.state.doc.toString() === base.replace("first", "remote"),
				"switch discarded a conflicting draft or overwrote the remote source");
		}
		passed.push("a synchronization conflict retains the old editor and both local and remote versions");

		for (const part of ["body", "title"]) {
			await open();
			const previous = root(), embedded = part === "title" ? title() : body();
			embedded.focus();
			embedded.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
			target("tip").click();
			await pause();
			assert(root() === previous && embedded.compositionStarted, `switch interrupted ${part} composition`);
			embedded.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
			await pause();
			target("tip").click();
			await pause(300);
			assertSwitched(previous, "body", "second", "Beta");
		}
		passed.push("body and title IME composition prevent switching until composition ends");

		const nested = base.replace("> first", "> first\n> \n> > [!warning] Inner\n> > deep");
		for (const composing of [false, true]) {
			await open(nested);
			const outer = body(), previous = root();
			outer.dispatch({ selection: { anchor: outer.state.doc.toString().indexOf("deep") + 1 } });
			await pause(250);
			const innerRoot = outer.dom.querySelector(".bbe-inline-editor");
			assert(innerRoot, "nested editor missing");
			const inner = cm.constructor.findFromDOM(innerRoot.querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"));
			inner.focus();
			if (composing) inner.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
			inner.dispatch({ changes: { from: inner.state.doc.length, insert: " edited" } });
			target("tip").click();
			if (composing) {
				await pause();
				assert(root() === previous && innerRoot.isConnected && inner.compositionStarted, "switch interrupted nested composition");
				inner.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
				await pause();
				target("tip").click();
			}
			await pause(300);
			assertSwitched(previous, "body", "second", "Beta");
			assert(cm.state.doc.toString() === nested.replace("deep", "deep edited"), "switch lost a nested pending edit: " +
				JSON.stringify({ composing, actual: cm.state.doc.toString(), expected: nested.replace("deep", "deep edited") }));
		}
		passed.push("nested drafts flush through all ancestors and nested IME keeps every editor alive");

		for (const selector of ["a", "input[type=checkbox]", ".callout-fold"]) {
			await open(base.replace("[!tip] Beta\n> second", "[!tip]+ [Beta](https://example.com)\n> - [ ] second"));
			const previous = root(), control = cm.dom.querySelector(".cm-callout " + selector);
			assert(control, `native ${selector} missing`);
			let prevented;
			control.addEventListener("click", event => {
				prevented = event.defaultPrevented;
				event.preventDefault(); event.stopImmediatePropagation();
			}, { capture: true, once: true });
			control.click();
			await pause();
			assert(prevented === false && root() === previous, `switch intercepted native ${selector}`);
		}
		passed.push("links, task checkboxes and fold controls keep their native handling while another editor is open");
		return JSON.stringify({ passed });
	} finally {
		if (typeof leaf.view.save === "function") await leaf.view.save();
		leaf.detach(); await pause(300);
		if (app.vault.getAbstractFileByPath(file.path) === file) await app.vault.delete(file);
		if (originalLeaf) app.workspace.setActiveLeaf(originalLeaf, { focus: true });
	}
})()
