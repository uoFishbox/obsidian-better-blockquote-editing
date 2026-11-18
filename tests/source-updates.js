// Run through Obsidian CLI eval; only the unique scratch note is changed.
(async () => {
	const pause = (ms = 120) => new Promise(resolve => setTimeout(resolve, ms));
	const assert = (condition, message) => { if (!condition) throw new Error(message); };
	const originalLeaf = app.workspace.activeLeaf;
	const file = await app.vault.create(`bbe-source-updates-${Date.now()}.md`, "");
	const leaf = app.workspace.getLeaf("tab");
	const passed = [];
	let stage = "initial";
	try {
		require("electron").remote.getCurrentWindow().focus();
		await leaf.openFile(file, { state: { mode: "source", source: false } });
		await pause(200);
		const view = leaf.view, editor = view.editor, cm = editor.cm;
		const root = () => cm.dom.querySelector(".bbe-inline-editor");
		const base = "before\n\n> [!note] Title\n> body\n> last\n\nafter";
		const open = async (text = base, needle = "body") => {
			if (root()) { root().querySelector(":scope > .bbe-close").click(); await pause(); }
			cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: text }, selection: { anchor: 0 }, userEvent: "input.fixture" });
			await pause();
			editor.setCursor(editor.offsetToPos(text.indexOf(needle) + 2)); editor.focus();
			await pause();
			assert(root()?.querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"), "native editor did not mount: " + JSON.stringify({
				text:editor.getValue(),selection:cm.state.selection.toJSON(),focus:cm.hasFocus,html:cm.contentDOM.innerHTML.slice(-700),
				state:cm.state.values.filter(v=>v&&typeof v==="object"&&"widget" in v).map(v=>({from:v.from,to:v.to,valid:v.valid,conflict:v.conflict})),
			}));
			const child = cm.constructor.findFromDOM(root().querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"));
			child.focus(); await pause(); return child;
		};
		const replace = (word, value) => {
			const at = editor.getValue().indexOf(word);
			assert(at >= 0, "missing source fixture: " + word);
			editor.replaceRange(value, editor.offsetToPos(at), editor.offsetToPos(at + word.length));
		};
		{
			const source = false;
			stage = `source=${source}, opening`;
			await view.setState({ ...view.getState(), mode: "source", source }, { history: false });
			const embedded = await open();
			const retained = root();
			embedded.dispatch({ selection: { anchor: 7 } }); await pause();
			replace("body", "remote body"); await pause();
			stage = `source=${source}, body received`;
			assert(embedded.state.doc.toString() === "remote body\nlast" && root() === retained && !root().querySelector(".bbe-conflict"),
				"external body change was not received without recreating the editor");
			assert(embedded.state.selection.main.head === 14, "external text did not map the retained caret");
			embedded.dispatch({ changes: { from: embedded.state.doc.length, insert: " local" } }); await pause();
			assert(editor.getValue().includes("> last local"), "editing did not continue after receiving an external change");
			replace("[!note] Title", "[!tip]+ **Changed**"); await pause(250);
			stage = `source=${source}, header received`;
			assert(root() === retained && root().querySelector('.bbe-callout[data-callout="tip"] .callout-title-inner strong')?.textContent === "Changed" &&
				cm.constructor.findFromDOM(root().querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor")) === embedded && embedded.state.doc.toString() === "remote body\nlast local",
				"header/type update lost the editor or failed to refresh the native callout");
			replace("[!tip]+ **Changed**\n> ", ""); await pause(250);
			stage = `source=${source}, plain quote`;
			assert(root().querySelector(".bbe-blockquote") && !root().querySelector(".bbe-callout") && embedded.dom.isConnected,
				"converting a callout to a plain quote lost its native editor");
		}
		passed.push("source edits and callout title/type/folding changes update the same native editor in Live Preview, retaining the caret and subsequent edits");

		let embedded = await open();
		replace("body", "remote body"); await pause();
		editor.undo(); await pause();
		assert(embedded.state.doc.toString() === "body\nlast" && editor.getValue() === base,
			"source Undo did not update the embedded editor");
		editor.redo(); await pause();
		assert(embedded.state.doc.toString() === "remote body\nlast", "source Redo did not update the embedded editor");
		editor.setCursor(editor.offsetToPos(editor.getValue().indexOf("last") + 2)); await pause();
		assert(embedded.state.selection.main.head === embedded.state.doc.toString().indexOf("last") + 2,
			"source cursor movement did not update the embedded cursor");
		passed.push("source Undo/Redo and source cursor movement are reflected in the embedded editor");

		embedded = await open();
		await view.save();
		await app.vault.modify(file, base.replace("body", "vault update")); await pause(350);
		assert(embedded.dom.isConnected && embedded.state.doc.toString() === "vault update\nlast" && !root().querySelector(".bbe-conflict"),
			"Vault modification was not received by the open embedded editor");
		passed.push("changes written through the Vault API update the currently open embedded editor");

		embedded = await open();
		embedded.dispatch({ changes: { from: 0, insert: "local " }, selection: { anchor: 6 } });
		replace("last", "remote last"); await pause();
		assert(embedded.state.doc.toString() === "local body\nremote last" && editor.getValue().includes("> local body\n> remote last") &&
			!root().querySelector(".bbe-conflict"), "disjoint pending and remote changes were not merged");
		passed.push("pending local input is rebased over a disjoint source edit without losing either change");
		const nativeEditor = app.workspace.activeEditor.editor;
		nativeEditor.undo(); await pause();
		assert(embedded.state.doc.toString() === "body\nremote last" && editor.getValue().includes("> remote last"),
			"native Undo removed the external change or lost local history");
		nativeEditor.redo(); await pause();
		assert(embedded.state.doc.toString() === "local body\nremote last", "native Redo failed after an incoming source edit");
		passed.push("native Undo/Redo keeps local history while retaining disjoint incoming source edits");

		embedded = await open();
		embedded.dispatch({ changes: { from: 0, insert: "local " } });
		replace("body", "remote body"); await pause();
		assert(embedded.state.doc.toString() === "remote local body\nlast" && editor.getValue().includes("> remote local body"),
			"simultaneous insertions at the same point lost input");
		passed.push("simultaneous inserts at the same position retain both texts in a deterministic order");

		embedded = await open();
		embedded.dispatch({ changes: { from: 0, to: 4, insert: "local" } });
		replace("body", "remote"); await pause();
		assert(root().querySelector(".bbe-conflict") && embedded.state.doc.toString().startsWith("local") && editor.getValue().includes("> remote"),
			"overlapping unsynced replacements overwrote one version");
		passed.push("overlapping unsynced replacements preserve both versions and display the conflict");

		embedded = await open();
		embedded.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
		embedded.dispatch({ changes: { from: 0, insert: "日本語 " } });
		replace("last", "remote last"); await pause();
		assert(embedded.compositionStarted && embedded.state.doc.toString() === "日本語 body\nlast", "source change interrupted active composition");
		embedded.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })); await pause(250);
		assert(!root().querySelector(".bbe-conflict") && embedded.state.doc.toString() === "日本語 body\nremote last" &&
			editor.getValue().includes("> 日本語 body\n> remote last"), "deferred source update did not merge after composition");
		passed.push("source changes wait for IME composition to end and then merge with the committed input");

		const nested = "before\n\n> [!note] Outer\n> start\n>\n> > [!tip] Inner\n> > body\n> > last\n>\n> end\n\nafter";
		embedded = await open(nested, "start");
		embedded.dispatch({ selection: { anchor: embedded.state.doc.toString().indexOf("body") + 2 } }); embedded.focus(); await pause(200);
		const innerRoot = embedded.dom.querySelector(".bbe-inline-editor");
		const inner = cm.constructor.findFromDOM(innerRoot.querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"));
		inner.focus(); inner.dispatch({ changes: { from: 0, insert: "local " } });
		replace("last", "remote last"); await pause(250);
		assert(innerRoot.isConnected && inner.state.doc.toString() === "local body\nremote last" &&
			editor.getValue().includes("> > local body\n> > remote last") && !root().querySelector(".bbe-conflict"), "nested source/local edits did not converge");
		passed.push("source edits propagate down nested editors while pending nested edits propagate back to the note");

		const switcher = app.plugins.plugins["obsidian-another-quick-switcher"];
		if (switcher) {
			inner.dispatch({ selection: { anchor: 6 } }); await pause();
			switcher.appHelper.insertStringToActiveFile("AQS "); await pause(250);
			assert(inner.state.doc.toString().includes("local AQS body") && editor.getValue().includes("> > local AQS body") &&
				!root().querySelector(".bbe-conflict"), "Another Quick Switcher insertion was not received by the embedded editor");
			passed.push("installed Another Quick Switcher can insert into the source cursor and the nested editor receives the change");
		}

		embedded = await open();
		const from = editor.getValue().indexOf(">"), to = editor.getValue().indexOf("\n\nafter");
		editor.replaceRange("", editor.offsetToPos(from), editor.offsetToPos(to)); await pause();
		assert(!root() && !editor.getValue().includes("[!note]") && !editor.getValue().includes("body"), "deleting the source quote resurrected it or retained an empty editor");
		passed.push("deleting a synchronized source quote closes its editor without recreating the deleted block");

		embedded = await open();
		embedded.dispatch({ changes: { from: 0, insert: "unsynced " } });
		editor.replaceRange("", editor.offsetToPos(editor.getValue().indexOf(">")), editor.offsetToPos(editor.getValue().indexOf("\n\nafter")));
		await pause();
		assert(root()?.querySelector(".bbe-conflict") && embedded.state.doc.toString().startsWith("unsynced ") && !editor.getValue().includes("unsynced"),
			"deleting a quote with pending input discarded the draft or recreated its source");
		passed.push("deleting a quote with pending input keeps the uncommitted draft without restoring the deleted source");
		return JSON.stringify({ passed });
	} catch (error) {
		throw new Error(`${error.stack}\nStage: ${stage}\nCompleted: ${JSON.stringify(passed)}`);
	} finally {
		if (typeof leaf.view.save === "function") await leaf.view.save();
		leaf.detach(); await pause(300);
		if (app.vault.getAbstractFileByPath(file.path) === file) await app.vault.delete(file);
		if (originalLeaf) app.workspace.setActiveLeaf(originalLeaf, { focus: true });
	}
})()
