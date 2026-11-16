// Obsidian CLI integration test. Only this temporary note is changed.
(async () => {
	const pause = (ms = 200) => new Promise(resolve => setTimeout(resolve, ms));
	const assert = (ok, message) => { if (!ok) throw new Error(message); };
	const originalLeaf = app.workspace.activeLeaf;
	const file = await app.vault.create(`bbe-type-${Date.now()}.md`, "");
	const leaf = app.workspace.getLeaf("tab");
	const passed = [];
	const modal = () => document.querySelector(".bbe-callout-type-modal");
	const press = (el, key, options = {}) => el.dispatchEvent(new KeyboardEvent("keydown", {
		key, code: key, bubbles: true, cancelable: true, ...options,
	}));
	try {
		require("electron").remote.getCurrentWindow().focus();
		await leaf.openFile(file, { state: { mode: "source", source: false } });
		await pause(250);
		const view = leaf.view, editor = view.editor, cm = editor.cm;
		const root = () => cm.dom.querySelector(".bbe-inline-editor");
		const icon = (scope = root()) => scope.querySelector(":scope > .bbe-callout > .callout-title > .callout-icon");
		const open = async (text, needle = "body") => {
			if (root()) { root().querySelector(":scope > .bbe-close").click(); await pause(); }
			cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: text }, selection: { anchor: 0 } });
			await pause();
			editor.setCursor(editor.offsetToPos(text.indexOf(needle))); editor.focus(); await pause(250);
			if (!root()) {
				app.commands.commands["obsidian-better-blockquote-editing:edit-quote-inline"].editorCheckCallback(false, editor, view);
				await pause(250);
			}
			assert(icon(), "callout icon missing");
			return cm.constructor.findFromDOM(root().querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"));
		};
		const choose = async type => {
			assert(modal(), "type modal missing");
			const input = modal().querySelector("input");
			input.value = type; input.dispatchEvent(new Event("input", { bubbles: true })); await pause();
			const suggestion = [...modal().querySelectorAll(".suggestion-item")].find(el => el.textContent === type);
			assert(suggestion, `suggestion missing: ${type}`);
			suggestion.click(); await pause(350);
			assert(!modal(), "type modal did not close");
		};
		const resting = async block => {
			if (root()) { root().querySelector(":scope > .bbe-close").click(); await pause(); }
			const text = `before\n\n${block}\n\nafter`;
			cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: text }, selection: { anchor: 0 } });
			cm.focus(); await pause(300);
			assert(!root(), "resting callout opened an editor");
			return text;
		};
		const clickRestingIcon = async (index = 0, pointerType = "mouse") => {
			const target = cm.dom.querySelectorAll(".cm-callout .callout-title > .callout-icon")[index].querySelector("svg");
			const options = { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true, pointerType };
			const pointer = new PointerEvent("pointerdown", options);
			target.dispatchEvent(pointer);
			const mouse = new MouseEvent("mousedown", options);
			if (pointerType === "mouse") target.dispatchEvent(mouse);
			assert(pointer.defaultPrevented && (pointerType !== "mouse" || mouse.defaultPrevented), "icon gesture moved native selection");
			await pause(30);
			target.dispatchEvent(new PointerEvent("pointerup", options));
			target.dispatchEvent(new MouseEvent("click", options));
			await pause();
			assert(modal() && !root(), "normal icon did not open the modal directly without an editor");
		};

		for (const [block, pointerType] of [
			["> [!note]+ **Title**\n> body", "mouse"],
			["  >[!note|wide]-\tTitle\n > body\nlazy continuation\n>", "touch"],
			["> [!note] Title", "pen"],
		]) {
			const text = await resting(block);
			await clickRestingIcon(0, pointerType);
			assert(cm.state.doc.toString() === text, "opening the type modal changed the source");
			await choose("warning");
			assert(editor.getValue() === text.replace("[!note", "[!warning") && !root(), "resting type change lost content or opened an editor");
			assert(cm.dom.querySelector('.cm-callout .callout[data-callout="warning"]'), "resting callout appearance did not update");
		}
		passed.push("normal mouse/touch/pen icon clicks open the modal without an editor, preserving folded, indented and header-only callouts");

		let normal = await resting("> [!note]+ Title\n> body");
		await clickRestingIcon();
		press(modal().querySelector("input"), "Escape"); await pause();
		assert(!root() && !modal() && editor.getValue() === normal, "normal modal cancel changed content or opened an editor");
		await clickRestingIcon(); await choose("success");
		press(cm.contentDOM, "z", { ctrlKey: true }); await pause(300);
		assert(editor.getValue() === normal && !root(), "normal type Undo failed or opened an editor");
		passed.push("normal cancel and Undo preserve the resting editor state");

		normal = await resting("> [!note] Outer\n> start\n>\n> > [!tip]+ Inner\n> > body");
		await clickRestingIcon(1); await choose("danger");
		assert(editor.getValue() === normal.replace("[!tip]", "[!danger]") && !root(), "normal nested icon changed the wrong callout or opened an editor");
		passed.push("normal nested icons change their own type without opening any editor");

		normal = await resting("> [!note]- Title\n> body");
		await clickRestingIcon();
		editor.replaceRange("extra\n", { line: 0, ch: 0 });
		const remoteTitle = editor.getValue().indexOf("Title");
		editor.replaceRange("Remote", editor.offsetToPos(remoteTitle), editor.offsetToPos(remoteTitle + 5)); await pause();
		await choose("info");
		assert(editor.getValue() === "extra\n" + normal.replace("Title", "Remote").replace("[!note]", "[!info]") && !root(),
			"normal modal lost changes made before or inside its target");
		passed.push("normal modal tracks source shifts and preserves incoming title edits");

		const text = "before\n\n  >[!question|wide]-\t**Title**\n > body\nlazy continuation\n> \n\nafter";
		let body = await open(text);
		const retained = body;
		const pointer = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, isPrimary: true });
		icon().dispatchEvent(pointer);
		assert(pointer.defaultPrevented, "icon pointer gesture was not isolated from callout folding");
		icon().click(); await pause();
		assert(modal() && icon().getAttribute("role") === "button", "icon did not open an accessible type control");
		await choose("warning");
		assert(editor.getValue() === text.replace("[!question", "[!warning"), "type change damaged metadata, fold marker, title or body");
		assert(root().querySelector('.bbe-callout[data-callout="warning"]') && body === retained && body.dom.isConnected,
			"type change did not update appearance or retained body editor: " + JSON.stringify({
				type: root().querySelector(".bbe-callout")?.dataset.callout, connected: body.dom.isConnected,
				source: editor.getValue(),
			}));
		assert(body.hasFocus, "body focus was not restored after selection: " + JSON.stringify({
			passed, focus: document.activeElement?.outerHTML.slice(0, 500), selection:cm.state.selection.toJSON(),
		}));
		passed.push("icon opens SuggestModal; selection preserves exact source and retained body editor");

		const updated = editor.getValue();
		icon().click(); await pause(); press(modal().querySelector("input"), "Escape"); await pause();
		assert(!modal() && editor.getValue() === updated && body.hasFocus, "cancel changed content or lost body focus");
		icon().focus(); press(icon(), "Enter"); await pause();
		assert(modal(), "Enter did not open the type modal");
		await choose("custom-type");
		assert(editor.getValue() === text.replace("[!question", "[!custom-type"), "custom type was not applied");
		icon().focus(); press(icon(), " "); await pause();
		await choose("faq");
		assert(editor.getValue().includes("[!faq|wide]-"), "alias was not applied");
		passed.push("Escape cancels; Enter/Space open the modal; custom types and aliases can be selected");

		cm.focus(); press(cm.contentDOM, "z", { ctrlKey: true }); await pause(350);
		assert(editor.getValue() === text.replace("[!question", "[!custom-type"), "Undo did not revert exactly one type change");
		assert(root().querySelector('.bbe-callout[data-callout="custom-type"]'), "Undo did not refresh callout appearance");
		passed.push("source Undo restores the previous type and appearance");

		body = await open("> [!note]\n> body");
		icon().click(); await pause(); await choose("tip");
		assert(editor.getValue() === "> [!tip]\n> body", "type change added a custom title");
		assert(root().querySelector(".callout-title-inner").textContent === "Tip", "default title did not follow the new type");
		passed.push("untitled callout uses the new type's default title");

		await open("> [!note]+ Title", "Title");
		const title = cm.constructor.findFromDOM(root().querySelector(".bbe-title-host .cm-editor"));
		title.dispatch({ changes: { from: 0, to: 5, insert: "日本語タイトル" }, selection: { anchor: 3 } });
		icon().click(); await pause(); await choose("example");
		assert(editor.getValue() === "> [!example]+ 日本語タイトル" && title.hasFocus && title.state.selection.main.head === 3,
			"header-only type change lost pending title text, focus or caret");
		passed.push("header-only callouts preserve pending title edits, title focus and caret");

		body = await open("> [!note] Outer\n> start\n>\n> > [!tip]+ Inner\n> > body", "start");
		body.dispatch({ selection: { anchor: body.state.doc.toString().indexOf("body") } }); body.focus(); await pause(300);
		const inner = body.dom.querySelector(".bbe-inline-editor");
		assert(inner && icon(inner), "nested callout did not open");
		icon(inner).click(); await pause(); await choose("danger");
		assert(editor.getValue() === "> [!note] Outer\n> start\n> \n> > [!danger]+ Inner\n> > body", "nested type change did not propagate or changed outer callout: " + JSON.stringify(editor.getValue()));
		passed.push("nested type changes synchronize through the outer editor");

		body = await open("> [!note]- Title\n> body");
		icon().click(); await pause();
		const at = editor.getValue().indexOf("Title");
		editor.replaceRange("Remote", editor.offsetToPos(at), editor.offsetToPos(at + 5)); await pause();
		await choose("success");
		assert(editor.getValue() === "> [!success]- Remote\n> body", "selection overwrote an incoming title edit");
		passed.push("changes arriving while the modal is open are retained");
		return JSON.stringify({ passed });
	} finally {
		if (modal()) press(modal().querySelector("input"), "Escape");
		if (typeof leaf.view.save === "function") await leaf.view.save();
		leaf.detach(); await pause(300);
		if (app.vault.getAbstractFileByPath(file.path) === file) await app.vault.delete(file);
		if (originalLeaf) app.workspace.setActiveLeaf(originalLeaf, { focus: true });
	}
})()
