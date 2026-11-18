// Use a scratch vault. This test opens a split pane and a pop-out window.
(async () => {
	const pause = (ms = 120) => new Promise(resolve => setTimeout(resolve, ms));
	const assert = (condition, message) => { if (!condition) throw new Error(message); };
	const workspace = app.workspace;
	const original = workspace.activeLeaf;
	const leaves = [];
	const files = [];
	const passed = [];
	try {
		const id = Date.now();
		const quote = await app.vault.create(`bbe-pane-${id}.md`, "before\n\n> [!note] Title\n> body\n\nafter");
		files.push(quote);
		const other = await app.vault.create(`bbe-pane-${id}-other.md`, "other note");
		files.push(other);
		const main = workspace.getLeaf("tab");
		leaves.push(main);
		const split = workspace.createLeafBySplit(main, "vertical");
		leaves.push(split);
		for (const [leaf, file] of [[main, quote], [split, other]]) {
			await leaf.openFile(file, { state: { mode: "source", source: false } });
		}
		const focus = async leaf => {
			const cm = leaf.view.editor.cm;
			const ownerDocument = cm.dom.ownerDocument;
			const { remote } = require("electron");
			const targetWindow = ownerDocument === document ? remote.getCurrentWindow() :
				remote.BrowserWindow.getAllWindows().find(win => win.getTitle() === ownerDocument.title);
			targetWindow?.focus();
			ownerDocument.defaultView.focus();
			await pause();
			cm.focus();
			workspace.setActiveLeaf(leaf, { focus: true });
			await pause();
			assert(workspace.activeLeaf === leaf && cm.root.activeElement === cm.contentDOM,
				"focus did not switch to the requested pane: " + JSON.stringify({
					activeLeaf: workspace.activeLeaf?.id, requested: leaf.id,
					windowFocus: cm.dom.ownerDocument.hasFocus(), activeElement: cm.root.activeElement?.className,
				}));
		};
		const editQuote = async (leaf, text) => {
			await focus(leaf);
			const editor = leaf.view.editor;
			editor.setCursor(editor.offsetToPos(editor.getValue().indexOf("body") + 1));
			await pause(250);
			const cm = editor.cm;
			const childDOM = cm.dom.querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor");
			assert(childDOM, "the callout editor did not mount");
			const child = cm.constructor.findFromDOM(childDOM);
			assert(child.root.activeElement === child.contentDOM && workspace.activeEditor?.editor?.cm === child,
				"the embedded editor did not receive focus and commands");
			workspace.activeEditor.editor.replaceSelection(text);
			await pause();
			assert(editor.getValue().includes(text), "the edit did not reach the callout");
		};
		await editQuote(main, "SPLIT-");
		await focus(split);
		assert(workspace.activeEditor?.editor === split.view.editor, "commands did not follow focus to the split pane");
		split.view.editor.replaceSelection("split ");
		assert(split.view.editor.getValue().includes("split ") && !main.view.editor.getValue().includes("split "),
			"split-pane input changed the wrong note");
		await main.view.save();
		passed.push("editing a callout and switching to a split pane routes input and commands to the focused editor");

		const popout = workspace.openPopoutLeaf();
		leaves.push(popout);
		const popoutQuote = await app.vault.create(`bbe-pane-${id}-window.md`, "before\n\n> [!note] Title\n> body\n\nafter");
		files.push(popoutQuote);
		await popout.openFile(popoutQuote, { state: { mode: "source", source: false } });
		await editQuote(popout, "WINDOW-");
		await focus(split);
		assert(workspace.activeEditor?.editor === split.view.editor, "commands did not return to the main window");
		await popout.view.save();
		assert((await app.vault.read(popoutQuote)).includes("WINDOW-"), "pop-out edits did not reach the vault");
		passed.push("a pop-out callout editor saves its edits and releases command focus when switching windows");
		return JSON.stringify({ passed });
	} finally {
		for (const leaf of leaves.reverse()) {
			await leaf.view.save?.();
			leaf.detach();
		}
		for (const file of files) if (app.vault.getAbstractFileByPath(file.path) === file) await app.vault.delete(file);
		if (original) workspace.setActiveLeaf(original, { focus: true });
	}
})()
