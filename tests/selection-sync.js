// Run through Obsidian CLI eval; only this scratch note is edited.
(async () => {
	const pause = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
	const assert = (condition, message) => { if (!condition) throw new Error(message); };
	const originalLeaf = app.workspace.activeLeaf;
	const file = await app.vault.create(`bbe-selection-${Date.now()}.md`, "");
	const leaf = app.workspace.getLeaf("tab");
	const passed = [];
	try {
		require("electron").remote.getCurrentWindow().focus();
		await leaf.openFile(file, { state: { mode: "source", source: false } });
		await pause(200);
		const view = leaf.view;
		const editor = view.editor;
		const cm = editor.cm;
		const root = () => cm.dom.querySelector(".bbe-inline-editor");
		const open = async (text, needle = "body") => {
			if (root()) { root().querySelector(":scope > .bbe-close").click(); await pause(); }
			cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: text }, selection: { anchor: 0 } });
			await pause();
			editor.setCursor(editor.offsetToPos(text.indexOf(needle) + 2));
			editor.focus();
			await pause();
			assert(root()?.querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"), "embedded editor missing");
			const child = cm.constructor.findFromDOM(root().querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"));
			child.focus();
			await pause();
			return child;
		};
		{
			const source = false;
			await view.setState({ ...view.getState(), mode: "source", source }, { history: false });
			for (const text of ["before\n\n> [!note] Title\n> body\n>\n> 日本語tail\n\nafter",
				"before\n\n  >body\n > \n>\t日本語tail\n\nafter", "before\n\n> body\nlazy continuation\n\nafter"]) {
				const embedded = await open(text);
				const retainedRoot = root();
				assert(cm.state.selection.main.empty && cm.state.selection.main.head === text.indexOf("body") + 2,
					"opening a quote selected the whole block or lost the initial caret");
				for (const [word, local] of [["body", 3], [text.includes("tail") ? "日本語tail" : "lazy continuation", 2]]) {
					const at = embedded.state.doc.toString().indexOf(word) + local;
					embedded.dispatch({ selection: { anchor: at } });
					await pause();
					assert(cm.state.selection.main.empty && cm.state.selection.main.head === editor.getValue().indexOf(word) + local,
						"body caret did not map to source markers/indentation: " + JSON.stringify({source,text,word,selection:cm.state.selection.toJSON()}));
				}
				const body = embedded.state.doc.toString();
				const last = body.indexOf(text.includes("tail") ? "日本語tail" : "lazy continuation") + 2;
				embedded.dispatch({ selection: { anchor: last, head: 1 } });
				await pause();
				assert(cm.state.selection.main.anchor === editor.getValue().indexOf(text.includes("tail") ? "日本語tail" : "lazy continuation") + 2 &&
					cm.state.selection.main.head === text.indexOf("body") + 1, "backward multiline selection was not preserved");
				embedded.dispatch({ changes: { from: 0, insert: "new\n" }, selection: { anchor: 4 } });
				await pause();
				assert(cm.state.selection.main.empty && cm.state.selection.main.head === editor.getValue().indexOf("body"),
					"typing a newline did not synchronize the source caret with its text");
				assert(root() === retainedRoot && embedded.dom.isConnected && app.workspace.activeEditor?.editor?.cm === embedded,
					"selection synchronization remounted the editor or stole focus");
			}
		}
		passed.push("caret and backward multiline selections map across headers, markers, blank/lazy lines and edits in Live Preview without losing focus");

		let embedded = await open("before\n\n> [!note] Title\n> body\n> last\n\nafter");
		const Selection = embedded.state.selection.constructor;
		embedded.dispatch({ selection: Selection.create([Selection.range(1, 3), Selection.cursor(7)], 1) });
		await pause();
		assert(embedded.state.selection.ranges.length === 2 && cm.state.selection.ranges.length === 2 && cm.state.selection.mainIndex === 1,
			"multiple selections or their primary range were lost");
		assert(cm.state.selection.ranges[0].anchor === editor.getValue().indexOf("body") + 1 &&
			cm.state.selection.ranges[1].head === editor.getValue().indexOf("last") + 2, "multiple selection offsets are incorrect");
		passed.push("multiple selections retain their ranges and primary caret in the source editor");

		const nested = "before\n\n> [!note] Outer\n> start\n>\n> > [!tip] Inner\n> > body\n> > last\n>\n> end\n\nafter";
		embedded = await open(nested, "start");
		embedded.dispatch({ selection: { anchor: embedded.state.doc.toString().indexOf("body") + 1 } });
		embedded.focus();
		await pause(200);
		const innerRoot = embedded.dom.querySelector(".bbe-inline-editor");
		assert(innerRoot, "nested editor missing");
		const inner = cm.constructor.findFromDOM(innerRoot.querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"));
		inner.dispatch({ selection: { anchor: 3 } });
		inner.focus();
		await pause();
		assert(embedded.state.selection.main.head === embedded.state.doc.toString().indexOf("body") + 3 &&
			cm.state.selection.main.head === editor.getValue().indexOf("body") + 3 && cm.state.selection.main.empty,
			"nested caret did not propagate through all enclosing editors");
		inner.dispatch({ changes: { from: 0, insert: "日本語\n" }, selection: { anchor: 5, head: 7 } });
		await pause();
		assert(editor.getSelection() === "od" && cm.state.selection.main.head === editor.getValue().indexOf("body") + 3,
			"nested text and selection did not reach the original note together");
		passed.push("nested cursors, selections and edits propagate through every ancestor to the source note");

		const switcher = app.plugins.plugins["obsidian-another-quick-switcher"];
		if (switcher) {
			assert(switcher.appHelper.getCurrentEditor() === editor && switcher.appHelper.getCurrentEditor().getSelection() === "od" &&
				switcher.appHelper.getCurrentOffset() === editor.getValue().indexOf("body") + 3,
				"Another Quick Switcher read the wrong selection or source offset");
			inner.dispatch({ selection: { anchor: 6 } });
			await pause();
			assert(switcher.appHelper.getCurrentEditor().getSelection() === "" &&
				switcher.appHelper.getCurrentOffset() === editor.getValue().indexOf("body") + 2,
				"Another Quick Switcher still sees a selected block when the embedded caret is collapsed");
			passed.push("installed Another Quick Switcher reads the actual selected text and full-note caret offset");
		}
		cm.dispatch({ selection: { anchor: 0 } });
		cm.focus();
		await pause();
		assert(!root() && cm.state.selection.main.head === editor.getValue().indexOf(">") - 1,
			"selection mirroring overrode an outside caret instead of closing the editor");
		passed.push("moving the source caret outside the quote still exits the embedded editor");
		return JSON.stringify({ passed });
	} finally {
		if (typeof leaf.view.save === "function") await leaf.view.save();
		leaf.detach();
		await pause(300);
		if (app.vault.getAbstractFileByPath(file.path) === file) await app.vault.delete(file);
		if (originalLeaf) app.workspace.setActiveLeaf(originalLeaf, { focus: true });
	}
})()
