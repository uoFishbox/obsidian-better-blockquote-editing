// Run through Obsidian CLI eval. Only this temporary note is changed.
(async () => {
	const pause = (ms = 200) => new Promise(resolve => setTimeout(resolve, ms));
	const assert = (ok, message) => { if (!ok) throw new Error(message); };
	const originalLeaf = app.workspace.activeLeaf;
	const file = await app.vault.create(`bbe-callout-insertion-${Date.now()}.md`, "");
	const leaf = app.workspace.getLeaf("tab");
	const passed = [];
	try {
		require("electron").remote.getCurrentWindow().focus();
		await leaf.openFile(file, { state: { mode: "source", source: false } });
		await pause(250);
		const editor = leaf.view.editor, cm = editor.cm;
		const root = () => cm.dom.querySelector(".bbe-inline-editor");
		const load = async (text, from = 0, to = from) => {
			if (root()) { root().querySelector(":scope > .bbe-close").click(); await pause(); }
			cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: text }, selection: { anchor: 0 } });
			cm.focus(); await pause();
			cm.dispatch({ selection: { anchor: from, head: to } });
			await pause();
		};
		const insert = () => app.commands.executeCommandById("editor:insert-callout");
		const bodyView = () => cm.constructor.findFromDOM(root().querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"));

		for (const [text, from, to, body] of [
			["", 0, 0, "Contents"],
			["before\n\n\nafter", 8, 8, "Contents"],
			["selected text", 0, 13, "selected text"],
			["first\nsecond", 0, 12, "first\nsecond"],
		]) {
			await load(text, from, to);
			insert();
			const source = editor.getValue();
			await pause(350);
			assert(root(), `insert command did not open the editor: ${JSON.stringify({ text, selection: cm.state.selection.toJSON() })}`);
			const inner = bodyView();
			const title = cm.constructor.findFromDOM(root().querySelector(".bbe-title-host .cm-editor"));
			assert(title.hasFocus && title.state.selection.main.from === 0 && title.state.selection.main.to === title.state.doc.length,
				"inserted callout did not select the entire title");
			assert(inner.state.doc.toString() === body && editor.getValue() === source,
				"opening changed the inserted content");
			if (!text) {
				title.dispatch(title.state.replaceSelection("日本語のタイトル"));
				await pause();
				assert(editor.getValue() === source.replace("Title", "日本語のタイトル"), "immediate title editing did not sync");
				title.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
					key: "Enter", code: "Enter", bubbles: true, cancelable: true,
				}));
				await pause();
				assert(inner.hasFocus && inner.state.selection.main.head === 0, "Enter did not move from the title to the body start");
				inner.dispatch({ changes: { from: 0, to: inner.state.doc.length, insert: "日本語の本文" } });
				await pause();
				assert(editor.getValue() === source.replace("Title", "日本語のタイトル").replace("Contents", "日本語の本文"), "immediate body editing did not sync");
			}
		}
		passed.push("native Insert callout selects the entire title for empty lines and selected single/multiple lines; typing replaces the title, syncs, and Enter moves to the body");

		await load("before\n\n> [!NOTE] Title\n> Contents\n\nafter");
		const source = editor.getValue(), typeFrom = source.indexOf("NOTE");
		cm.dispatch({ selection: { anchor: typeFrom, head: typeFrom + 4 } });
		await pause();
		assert(!root(), "ordinary type selection opened an editor");
		cm.dispatch({ changes: { from: typeFrom, to: typeFrom + 4, insert: "WARNING" },
			selection: { anchor: typeFrom, head: typeFrom + 7 } });
		await pause();
		assert(!root(), "replacing only the type opened an editor");
		passed.push("ordinary type selections and type-only replacements remain selections");

		await load("before\n\n\nafter", 8);
		insert(); await pause(350);
		assert(root(), "insertion after an ordinary type selection failed");
		root().querySelector(":scope > .bbe-close").click(); await pause();
		assert(!root(), "closed editor reopened itself");
		insert(); await pause(350);
		assert(root(), "inserting after closing an editor did not open the next editor");
		passed.push("closing stays closed and a subsequent insertion opens its editor");

		await load("before\n\n> [!note] Outer\n> body\n\nafter");
		cm.dispatch({ selection: { anchor: editor.getValue().indexOf("body") } });
		await pause(350);
		assert(root(), "outer editor missing");
		const outer = bodyView();
		outer.dispatch({ selection: { anchor: 0, head: outer.state.doc.length } });
		outer.focus();
		insert(); await pause(500);
		const nested = outer.dom.querySelector(".bbe-inline-editor");
		assert(nested, "nested insertion did not open its editor");
		const nestedTitle = cm.constructor.findFromDOM(nested.querySelector(".bbe-title-host .cm-editor"));
		assert(nestedTitle.hasFocus && nestedTitle.state.selection.main.from === 0 && nestedTitle.state.selection.main.to === nestedTitle.state.doc.length,
			"nested insertion did not select the entire title");
		assert(editor.getValue().includes("> > [!NOTE]"), "nested insertion did not sync quote prefixes");
		passed.push("inserting a nested callout selects its entire title and syncs the enclosing quote prefixes");

		root().querySelector(":scope > .bbe-close").click(); await pause();
		await leaf.view.setState({ ...leaf.view.getState(), mode: "source", source: true }, { history: false });
		await pause();
		editor.setValue(""); editor.setCursor({ line: 0, ch: 0 }); editor.focus();
		insert(); await pause(350);
		assert(!root() && editor.getSelection() === "NOTE", "source mode insertion was intercepted");
		passed.push("Source mode retains native insertion and its type selection");
		return JSON.stringify({ passed });
	} finally {
		if (typeof leaf.view.save === "function") await leaf.view.save();
		leaf.detach(); await pause(300);
		if (app.vault.getAbstractFileByPath(file.path) === file) await app.vault.delete(file);
		if (originalLeaf) app.workspace.setActiveLeaf(originalLeaf, { focus: true });
	}
})()
