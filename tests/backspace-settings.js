// Obsidian CLI integration test. Restore the user's settings and remove the scratch note.
(async () => {
	const pause = (ms = 180) => new Promise(resolve => setTimeout(resolve, ms));
	const assert = (ok, message) => { if (!ok) throw new Error(message); };
	const id = "obsidian-better-blockquote-editing";
	const plugin = app.plugins.plugins[id];
	const originalData = await plugin.loadData();
	const originalBehavior = plugin.settings.backspaceBehavior;
	const originalLeaf = app.workspace.activeLeaf;
	const file = await app.vault.create(`bbe-backspace-settings-${Date.now()}.md`, "");
	const leaf = app.workspace.getLeaf("tab");
	const passed = [];
	try {
		require("electron").remote.getCurrentWindow().focus();
		await leaf.openFile(file, { state: { mode: "source", source: false } });
		app.workspace.setActiveLeaf(leaf, { focus: true }); await pause(500);
		const cm = leaf.view.editor.cm;
		const root = () => cm.dom.querySelector(".bbe-inline-editor");
		const body = target => cm.constructor.findFromDOM(target.querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"));
		const press = target => target.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
			key: "Backspace", code: "Backspace", bubbles: true, cancelable: true,
		}));
		const close = async () => { root()?.querySelector(":scope > .bbe-close").click(); await pause(); };
		const choose = async value => {
			const tab = app.setting.pluginTabs.find(tab => tab.id === id);
			assert(tab, "plugin settings tab missing");
			tab.display();
			const dropdown = tab.containerEl.querySelector("select");
			assert(dropdown && dropdown.options.length === 2 && dropdown.value === plugin.settings.backspaceBehavior,
				"settings dropdown does not show the current behavior and both options");
			dropdown.value = value;
			dropdown.dispatchEvent(new Event("change", { bubbles: true })); await pause();
			assert(plugin.settings.backspaceBehavior === value && (await plugin.loadData()).backspaceBehavior === value,
				"settings UI did not update and persist the selected behavior");
			cm.focus();
		};
		const load = async block => {
			await close();
			const text = "before\n\n" + block + "\n\nafter";
			cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: text }, selection: { anchor: text.length } });
			cm.focus(); await pause();
			cm.dispatch({ selection: { anchor: text.indexOf("\n\nafter") + 1 } }); cm.focus(); await pause();
			return text;
		};
		await choose("delete");
		for (const block of ["> quote\n> last", "> [!note] Title\n> body\n> last"]) {
			await load(block); press(cm); await pause();
			assert(cm.state.doc.toString() === "before\n\n\nafter" && !root(), "delete option did not remove the quote/callout");
		}
		passed.push("the settings dropdown persists the delete option and applies it to both quotes and callouts");
		await choose("edit");
		for (const block of ["> quote\n> last", ">", "> first\nlazy last", "> [!note] Title\n> body\n> last",
			"> [!tip]- Folded\n> body", "> [!note]", "> [!note] Title\n> body\n> "]) {
			const text = await load(block); press(cm); await pause(350);
			assert(root(), "edit option did not open the quote/callout: " + block);
			const embedded = body(root());
			assert(embedded.hasFocus && embedded.state.selection.main.empty &&
				embedded.state.selection.main.head === embedded.state.doc.length,
				"edit option did not focus the end of the body: " + block);
			assert(cm.state.doc.toString() === text, "opening at the body end changed the source: " + block);
			if (embedded.state.doc.length) {
				const before = embedded.state.doc.toString();
				press(embedded); await pause();
				assert(root() && embedded.state.doc.toString() === before.slice(0, -1), "a second Backspace did not delete a body character");
			}
		}
		passed.push("edit opens regular, empty, lazy, folded and header-only blocks at the body end without changing the source; the next Backspace edits normally");
		for (const inner of ["> inner\n> last", "> [!tip] Inner\n> body\n> last"]) {
			const nested = "> outer\n> \n" + inner.split("\n").map(line => "> " + line).join("\n") + "\n> \n> tail";
			const text = await load(nested);
			cm.dispatch({ selection: { anchor: text.indexOf("outer") + 1 } }); cm.focus(); await pause(350);
			const outer = body(root());
			await choose("delete");
			await choose("edit");
			outer.dispatch({ selection: { anchor: outer.state.doc.toString().indexOf("\n\ntail") + 1 } }); outer.focus(); await pause();
			press(outer); await pause(350);
			const innerRoot = outer.dom.querySelector(".bbe-inline-editor");
			assert(innerRoot, "setting changes did not reach an already open nested editor");
			const embedded = body(innerRoot);
			assert(embedded.hasFocus && embedded.state.selection.main.head === embedded.state.doc.length && cm.state.doc.toString() === text,
				"nested quote/callout did not open at its body end without changing the enclosing quote");
			await choose("delete");
			innerRoot.querySelector(":scope > .bbe-close").click(); await pause();
			press(outer); await pause();
			assert(outer.state.doc.toString() === "outer\n\n\ntail" && !outer.dom.querySelector(".bbe-inline-editor"),
				"live delete setting did not reach the already open enclosing editor");
		}
		passed.push("setting changes immediately reach already open editors and nested quotes/callouts");
		await close();
		await choose("edit");
		await app.plugins.unloadPlugin(id);
		await app.plugins.loadPlugin(id);
		assert(app.plugins.plugins[id].settings.backspaceBehavior === "edit", "plugin reload lost the saved preference");
		passed.push("the saved behavior survives a plugin reload");
		return JSON.stringify({ passed });
	} catch (error) {
		throw new Error(`${error.stack}\nCompleted: ${JSON.stringify(passed)}`);
	} finally {
		const current = app.plugins.plugins[id];
		current.settings.backspaceBehavior = originalBehavior;
		await current.saveData(originalData);
		await leaf.view.save(); leaf.detach(); await pause();
		if (app.vault.getAbstractFileByPath(file.path) === file) await app.vault.delete(file);
		if (originalLeaf) app.workspace.setActiveLeaf(originalLeaf, { focus: true });
	}
})()
