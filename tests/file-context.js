// Run through Obsidian CLI eval. All created files live in a unique scratch folder.
(async () => {
	const pause = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
	const assert = (condition, message) => { if (!condition) throw new Error(message); };
	const waitFor = async (predicate, message) => {
		const deadline = Date.now() + 4000;
		while (!predicate() && Date.now() < deadline) await pause();
		assert(predicate(), typeof message === "function" ? message() : message);
	};
	const originalLeaf = app.workspace.activeLeaf;
	const attachmentFolder = app.vault.getConfig("attachmentFolderPath");
	const folder = await app.vault.createFolder(`bbe-file-context-${Date.now()}`);
	const leaf = app.workspace.getLeaf("tab");
	const passed = [];
	try {
		require("electron").remote.getCurrentWindow().focus();
		await app.vault.createFolder(`${folder.path}/assets`);
		const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII="), c => c.charCodeAt(0));
		const image = await app.vault.createBinary(`${folder.path}/assets/relative.png`, png.buffer);
		const target = await app.vault.create(`${folder.path}/target.md`, "# Target\n\nLocal target");
		const initial = "before\n\n> [!note] File context\n> body\n>\n> ![](assets/relative.png)\n>\n> tail\n\nafter";
		const file = await app.vault.create(`${folder.path}/source.md`, initial);
		const other = await app.vault.create(`${folder.path}/other.md`, "> other body\n\noutside");
		await leaf.openFile(file, { state: { mode: "source", source: false } });
		await pause(200);
		let view = leaf.view;
		let editor = view.editor;
		let cm = editor.cm;
		const root = () => cm.dom.querySelector(".bbe-inline-editor");
		const child = () => cm.constructor.findFromDOM(root().querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"));
		const open = async (needle = "body") => {
			editor.setCursor(editor.offsetToPos(editor.getValue().indexOf(needle)));
			editor.focus();
			app.workspace.activeEditor = view;
			await waitFor(() => root()?.querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"), "embedded editor did not mount");
			const embedded = child();
			embedded.focus();
			await pause();
			return embedded;
		};
		const close = async () => {
			root().querySelector(":scope > .bbe-close").click();
			await waitFor(() => !root(), "embedded editor did not close");
		};
		let embedded = await open();
		let owner = app.workspace.activeEditor;
		assert(owner !== view && owner.file === file && owner.editor.cm === embedded,
			"active embedded editor does not identify the source file");
		assert(owner.editMode.file === file && owner.editMode.path === file.path &&
			owner.editMode.clipboardManager.getPath() === file.path,
			"native editor or clipboard manager lost the source file");
		passed.push("embedded editor, active editor and clipboard manager share the source TFile");

		await waitFor(() => embedded.dom.querySelector(".image-embed img"), "relative image was not rendered");
		assert(embedded.dom.querySelector(".image-embed img").src === app.vault.getResourcePath(image),
			"relative image resolved against the wrong note");
		passed.push("relative image embeds resolve from the source note folder");
		if (originalLeaf && originalLeaf !== leaf) {
			embedded.contentDOM.blur();
			app.workspace.setActiveLeaf(originalLeaf, { focus: true });
			await pause();
			assert(app.workspace.activeLeaf === originalLeaf && owner.file === file && owner.editMode.path === file.path,
				"activating another tab changed the embedded editor's file context");
			app.workspace.setActiveLeaf(leaf, { focus: true });
			embedded.focus();
			await pause();
			passed.push("activating a different note does not change the existing embedded editor's file context");
		}

		// Trigger the real native link suggester, including its source-file context.
		embedded.dispatch({ changes: { from: 0, insert: "[[target" }, selection: { anchor: 8 }, userEvent: "input.type" });
		await waitFor(() => owner.editMode.editorSuggest.currentSuggest?.context?.query === "target", "link suggestions did not open");
		const suggest = owner.editMode.editorSuggest.currentSuggest;
		assert(suggest.context.file === file && suggest.context.editor === owner.editor,
			"link suggestions received the wrong source file or editor");
		const suggestions = await suggest.getSuggestions(suggest.context);
		const choice = suggestions?.find(item => item.file === target);
		assert(choice, "local note was missing from link suggestions");
		suggest.selectSuggestion(choice, new KeyboardEvent("keydown", { key: "Enter" }));
		await pause();
		assert(editor.getValue().includes("target") && !editor.getValue().includes("[[targetbody"), "link completion did not reach the source quote");
		passed.push("native link suggestions receive the source file and completion syncs to the quote");
		await close();

		const nested = "> [!note] Outer\n> start\n>\n> > [!tip] Inner\n> > body\n>\n> end\n\noutside";
		editor.setValue(nested);
		embedded = await open("start");
		embedded.dispatch({ selection: { anchor: embedded.state.doc.toString().indexOf("body") } });
		embedded.focus();
		await waitFor(() => embedded.dom.querySelector(".bbe-inline-editor .bbe-editor-host > .markdown-source-view > .cm-editor"), "inner editor did not mount");
		const inner = cm.constructor.findFromDOM(embedded.dom.querySelector(".bbe-inline-editor .bbe-editor-host > .markdown-source-view > .cm-editor"));
		inner.focus();
		await pause();
		owner = app.workspace.activeEditor;
		assert(owner.file === file && owner.editor.cm === inner && owner.editMode.path === file.path,
			"nested editor did not inherit the source file");
		await app.vault.createFolder(`${folder.path}/moved`);
		await app.vault.createFolder(`${folder.path}/moved/assets`);
		await app.fileManager.renameFile(file, `${folder.path}/moved/renamed.md`);
		assert(owner.file === file && owner.editMode.path === file.path && owner.editMode.clipboardManager.getPath() === file.path,
			"renaming the source left a stale path");
		passed.push("nested editors inherit the source TFile and follow file renames");

		app.vault.setConfig("attachmentFolderPath", "./assets");
		const filesBeforePaste = new Set(app.vault.getFiles());
		const pastedImage = () => app.vault.getFiles().find(f => !filesBeforePaste.has(f) &&
			f.path.startsWith(`${folder.path}/moved/assets/`) && f.extension === "png");
		const transfer = new DataTransfer();
		transfer.items.add(new File([png], "pasted.png", { type: "image/png" }));
		const paste = new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true });
		inner.contentDOM.dispatchEvent(paste);
		await waitFor(pastedImage, () =>
			"pasted image was not saved relative to the source note: " + JSON.stringify({passed,
				connected:inner.dom.isConnected,activeFile:app.workspace.activeEditor?.file?.path,prevented:paste.defaultPrevented,
				files:app.vault.getFiles().filter(f=>f.path.startsWith(folder.path)).map(f=>f.path),body:editor.getValue(),
			}));
		await waitFor(() => editor.getValue().includes(pastedImage().name), "pasted image link did not sync through the nested quote");
		assert(editor.getValue().split("\n").some(line => line.startsWith("> > ") && line.includes(pastedImage().name)),
			"pasted image lost its quote context");
		passed.push("native image paste saves beside the renamed note and synchronizes through nested editors");
		await close();

		await leaf.openFile(other, { state: { mode: "source", source: false } });
		await pause(200);
		view = leaf.view;
		editor = view.editor;
		cm = editor.cm;
		embedded = await open("other body");
		assert(app.workspace.activeEditor.file === other && app.workspace.activeEditor.editor.cm === embedded,
			"switching notes reused the previous file context");
		passed.push("switching notes binds newly opened editors to the new file");
		return JSON.stringify({ passed });
	} finally {
		app.vault.setConfig("attachmentFolderPath", attachmentFolder);
		if (typeof leaf.view.save === "function") await leaf.view.save();
		leaf.detach();
		await pause(300);
		if (app.vault.getAbstractFileByPath(folder.path) === folder) await app.vault.delete(folder, true);
		if (originalLeaf) app.workspace.setActiveLeaf(originalLeaf, { focus: true });
	}
})()
