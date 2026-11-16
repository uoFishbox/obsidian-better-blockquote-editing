// Run through Obsidian CLI eval; only the unique scratch note is changed.
(async () => {
	const pause = (ms = 150) => new Promise(resolve => setTimeout(resolve, ms));
	const assert = (condition, message) => { if (!condition) throw new Error(message); };
	const original = app.workspace.activeLeaf;
	const text = "before\n\n> [!note] Title\n> body\n> last\n\nafter";
	const file = await app.vault.create(`bbe-source-mode-${Date.now()}.md`, text);
	const leaf = app.workspace.getLeaf("tab");
	const passed = [];
	try {
		require("electron").remote.getCurrentWindow().focus();
		await leaf.openFile(file, { state: { mode: "source", source: true } });
		await pause();
		const view = leaf.view, editor = view.editor, cm = editor.cm;
		const root = () => cm.dom.querySelector(".bbe-inline-editor");
		const command = app.commands.commands["obsidian-better-blockquote-editing:edit-quote-inline"];
		const plugin = app.plugins.plugins["obsidian-better-blockquote-editing"];
		const mode = async source => { await view.setState({ ...view.getState(), mode: "source", source }, { history: false }); await pause(); };
		const open = async () => {
			editor.setCursor(editor.offsetToPos(editor.getValue().indexOf("body") + 2)); editor.focus();
			await pause();
			if (!root()) {
				app.workspace.activeEditor = view;
				assert(command.editorCheckCallback(false, editor, view), "Live Preview command unavailable");
				await pause();
			}
			assert(root()?.querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"), "Live Preview editor did not mount");
			const embedded = cm.constructor.findFromDOM(root().querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"));
			embedded.focus(); await pause(); return embedded;
		};
		editor.setValue(text);
		editor.setCursor(editor.offsetToPos(text.indexOf("body") + 2)); editor.focus();
		assert(!root() && !command.editorCheckCallback(true, editor, view) && !command.editorCheckCallback(false, editor, view) &&
			plugin.getTarget(editor) === null, "Source mode allowed auto-open, command, or shared menu targeting");
		assert(editor.getValue() === text && cm.state.selection.main.head === text.indexOf("body") + 2,
			"Source mode changed the raw source or caret: " + JSON.stringify({text:editor.getValue(),selection:cm.state.selection.toJSON(),state:view.getState()}));
		editor.replaceSelection("RAW ");
		assert(!root() && editor.getValue().includes("> boRAW dy"), "Source mode did not retain normal Markdown editing");
		await pause();
		assert(!root(), "Source mode opened an editor after a source selection or edit");
		passed.push("Source mode preserves raw Markdown editing and blocks automatic, command and menu entry points");

		editor.setValue(text); editor.setCursor(editor.offsetToPos(text.indexOf("body") + 2)); editor.focus();
		await mode(false);
		let embedded = await open();
		embedded.dispatch({ changes: { from: 0, insert: "pending " }, selection: { anchor: 8 } });
		await mode(true);
		assert(!root() && editor.getValue().includes("> pending body") && cm.state.selection.main.head === editor.getValue().indexOf("body"),
			"switching to Source mode retained the widget, lost pending input, or moved the caret");
		editor.focus(); await pause();
		assert(!root(), "refocusing inside the source quote reopened the widget");
		passed.push("switching Live Preview to Source mode flushes pending input and keeps the source caret without reopening");

		await mode(false);
		embedded = await open();
		assert(embedded.state.doc.toString().startsWith("pending body"), "returning to Live Preview lost the saved text");
		passed.push("returning to Live Preview enables inline editing again");

		root().querySelector(":scope > .bbe-close").click(); await pause();
		const nested = "> [!note] Outer\n> start\n>\n> > [!tip] Inner\n> > body\n>\n> end\n\noutside";
		editor.setValue(nested); await pause();
		editor.setCursor(editor.offsetToPos(nested.indexOf("start") + 2)); editor.focus(); await pause();
		if (!root()) { app.workspace.activeEditor = view; command.editorCheckCallback(false, editor, view); await pause(); }
		embedded = cm.constructor.findFromDOM(root().querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"));
		embedded.dispatch({ selection: { anchor: embedded.state.doc.toString().indexOf("body") } }); embedded.focus(); await pause();
		for (let retry = 0; retry < 20 && !embedded.dom.querySelector(".bbe-inline-editor .bbe-editor-host > .markdown-source-view > .cm-editor"); retry++) await pause(50);
		const inner = cm.constructor.findFromDOM(embedded.dom.querySelector(".bbe-inline-editor .bbe-editor-host > .markdown-source-view > .cm-editor"));
		inner.focus(); inner.dispatch({ changes: { from: 0, insert: "nested pending " } });
		await mode(true);
		assert(!root() && editor.getValue().includes("> > nested pending body"), "mode switch lost a pending nested edit or retained a nested editor");
		passed.push("switching modes flushes nested drafts and removes all embedded editors");

		editor.setValue(text); editor.setCursor(editor.offsetToPos(text.indexOf("body"))); editor.focus(); await mode(false);
		embedded = await open();
		embedded.dispatch({ changes: { from: 0, to: 4, insert: "LOCAL DRAFT" } });
		const at = editor.getValue().indexOf("body");
		editor.replaceRange("REMOTE", editor.offsetToPos(at), editor.offsetToPos(at + 4)); await pause();
		assert(root().querySelector(".bbe-conflict"), "conflict fixture did not retain a draft");
		await mode(true);
		const recovery = document.querySelector(".bbe-draft-recovery");
		assert(!root() && recovery?.querySelector("textarea").value.includes("LOCAL DRAFT") && editor.getValue().includes("> REMOTE"),
			"Source mode either kept the editor, lost the draft, or overwrote the external change");
		const closeRecovery = recovery.querySelector(":scope > .modal-header-button");
		assert(closeRecovery, "recovery close control missing: " + recovery.parentElement.outerHTML.slice(0,1800));
		closeRecovery.click();
		passed.push("conflicted drafts remain available to copy while Source mode contains no embedded editor");
		return JSON.stringify({ passed });
	} catch (error) {
		throw new Error(`${error.stack}\nCompleted: ${JSON.stringify(passed)}`);
	} finally {
		document.querySelector(".bbe-draft-recovery > .modal-header-button")?.click();
		if (typeof leaf.view.save === "function") await leaf.view.save();
		leaf.detach(); await pause(300);
		if (app.vault.getAbstractFileByPath(file.path) === file) await app.vault.delete(file);
		if (original) app.workspace.setActiveLeaf(original, { focus: true });
	}
})()
