// Obsidian CLI integration test. Restore preferences and remove the scratch note.
(async () => {
	const pause = (ms = 180) => new Promise(resolve => setTimeout(resolve, ms));
	const assert = (ok, message) => { if (!ok) throw new Error(message); };
	const id = "better-blockquote-editing";
	const plugin = () => app.plugins.plugins[id];
	const originalData = await plugin().loadData();
	const originalSettings = { ...plugin().settings };
	const originalLeaf = app.workspace.activeLeaf;
	const file = await app.vault.create(`bbe-ctrl-backspace-${Date.now()}.md`, "");
	const leaf = app.workspace.getLeaf("tab");
	const passed = [];
	try {
		require("electron").remote.getCurrentWindow().focus();
		await leaf.openFile(file, { state: { mode: "source", source: false } });
		app.workspace.setActiveLeaf(leaf, { focus: true }); await pause(500);
		const view = leaf.view, cm = view.editor.cm;
		const root = () => cm.dom.querySelector(".bbe-inline-editor");
		const press = (target, options = {}) => target.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
			key: "Backspace", code: "Backspace", ctrlKey: true, bubbles: true, cancelable: true, ...options,
		}));
		const tab = () => app.setting.pluginTabs.find(tab => tab.id === id);
		const toggle = () => tab().containerEl.querySelector(".checkbox-container");
		const mode = async value => {
			tab().display();
			const dropdown = tab().containerEl.querySelector("select");
			dropdown.value = value;
			dropdown.dispatchEvent(new Event("change", { bubbles: true })); await pause();
			assert(!!toggle() === (value === "edit"), "toggle visibility did not follow the selected mode");
		};
		const setToggle = async enabled => {
			assert(toggle(), "Ctrl+Backspace toggle missing in edit mode");
			if (plugin().settings.ctrlBackspaceDeletesBlock !== enabled) {
				const input = toggle().querySelector("input");
				assert(input, "Ctrl+Backspace input missing");
				input.checked = enabled;
				input.dispatchEvent(new Event("change", { bubbles: true }));
			}
			await pause();
			assert(plugin().settings.ctrlBackspaceDeletesBlock === enabled &&
				(await plugin().loadData()).ctrlBackspaceDeletesBlock === enabled, "toggle did not update and persist the preference");
		};
		const load = async block => {
			require("electron").remote.getCurrentWindow().focus();
			root()?.querySelector(":scope > .bbe-close").click(); await pause();
			const text = "before\n\n" + block + "\n\nafter";
			cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: text }, selection: { anchor: text.length } });
			cm.focus(); await pause();
			cm.dispatch({ selection: { anchor: text.indexOf("\n\nafter") + 1 } }); cm.focus(); await pause();
			return text;
		};
		await mode("delete");
		await mode("edit");
		await setToggle(false);
		for (const enabled of [false, true]) {
			await setToggle(enabled);
			for (const block of ["> quote\n> last", "> [!note] Title\n> body\n> last", "> [!note]"]) {
				const text = await load(block); press(cm); await pause();
				if (enabled) {
					assert(cm.state.doc.toString() === "before\n\n\nafter" && !root(), "enabled Ctrl+Backspace did not delete the whole block");
					cm.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
						key: "z", code: "KeyZ", bubbles: true, cancelable: true,
						...(process.platform === "darwin" ? { metaKey: true } : { ctrlKey: true }),
					})); await pause();
					assert(cm.state.doc.toString() === text, "undo did not restore Ctrl+Backspace deletion");
				} else {
					assert(cm.state.doc.toString().includes(block), "disabled Ctrl+Backspace deleted the whole block");
				}
			}
		}
		passed.push("the toggle appears only in edit mode, persists both states and controls whole-block Ctrl+Backspace deletion for quotes and callouts, with undo");
		for (const block of ["> quote\n> last", "> [!tip]- Folded\n> body"]) {
			const text = await load(block); press(cm, { ctrlKey: false }); await pause(350);
			assert(root() && cm.state.doc.toString() === text, "the toggle changed ordinary Backspace behavior");
			const embedded = cm.constructor.findFromDOM(root().querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"));
			assert(embedded.root.activeElement === embedded.contentDOM &&
				embedded.state.selection.main.head === embedded.state.doc.length, "ordinary Backspace did not focus the body end");
			press(embedded); await pause();
			assert(root() && cm.state.doc.toString().includes(">"), "Ctrl+Backspace inside the body deleted its enclosing block");
		}
		passed.push("ordinary Backspace still opens the body end and Ctrl+Backspace within the body keeps normal editing");
		for (const inner of ["> inner\n> last", "> [!tip] Inner\n> body"]) {
			const text = await load("> outer\n> \n" + inner.split("\n").map(line => "> " + line).join("\n") + "\n> \n> tail");
			cm.dispatch({ selection: { anchor: text.indexOf("outer") + 1 } }); cm.focus(); await pause(350);
			const outer = cm.constructor.findFromDOM(root().querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"));
			outer.dispatch({ selection: { anchor: outer.state.doc.toString().indexOf("\n\ntail") + 1 } }); outer.focus(); await pause();
			press(outer); await pause();
			assert(outer.state.doc.toString() === "outer\n\n\ntail" && cm.state.doc.toString() === "before\n\n> outer\n> \n> \n> tail\n\nafter",
				"Ctrl+Backspace did not delete and synchronize just the nested block: " + JSON.stringify({ inner, body: outer.state.doc.toString(), text: cm.state.doc.toString(), selection: outer.state.selection.toJSON(), focus: outer.hasFocus, settings: plugin().settings }));
		}
		passed.push("Ctrl+Backspace deletes nested quotes and callouts without deleting the enclosing quote");
		await mode("delete");
		assert(plugin().settings.ctrlBackspaceDeletesBlock === true, "hiding the toggle lost its value");
		await load("> quote\n> last"); press(cm); await pause();
		assert(cm.state.doc.toString().includes("> quote\n> last"), "the hidden toggle intercepted Ctrl+Backspace in delete mode");
		await mode("edit");
		await load("> quote\n> last");
		await view.setState({ ...view.getState(), mode: "source", source: true }, { history: false }); await pause();
		cm.focus(); press(cm); await pause();
		assert(cm.state.doc.toString().includes("> quote\n> last"), "Ctrl+Backspace deleted the whole quote in Source mode");
		passed.push("the hidden toggle preserves its value and does not override delete mode or Source mode");
		await app.plugins.unloadPlugin(id);
		await app.plugins.loadPlugin(id);
		assert(plugin().settings.backspaceBehavior === "edit" && plugin().settings.ctrlBackspaceDeletesBlock === true,
			"plugin reload lost the enabled toggle");
		passed.push("the enabled toggle survives a plugin reload");
		return JSON.stringify({ passed });
	} catch (error) {
		throw new Error(`${error.stack}\nCompleted: ${JSON.stringify(passed)}`);
	} finally {
		Object.assign(plugin().settings, originalSettings);
		await plugin().saveData(originalData);
		await leaf.view.save(); leaf.detach(); await pause();
		if (app.vault.getAbstractFileByPath(file.path) === file) await app.vault.delete(file);
		if (originalLeaf) app.workspace.setActiveLeaf(originalLeaf, { focus: true });
	}
})()
