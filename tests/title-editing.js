// Obsidian CLI integration test. Only this temporary note is changed.
(async () => {
	const pause = (ms = 150) => new Promise(resolve => setTimeout(resolve, ms));
	const assert = (ok, message) => { if (!ok) throw new Error(message); };
	const originalLeaf = app.workspace.activeLeaf;
	const file = await app.vault.create(`bbe-title-${Date.now()}.md`, "");
	const target = await app.vault.create(`bbe-title-link-${Date.now()}.md`, "Link target");
	const leaf = app.workspace.getLeaf("tab");
	const passed = [];
	try {
		require("electron").remote.getCurrentWindow().focus();
		await leaf.openFile(file, { state: { mode: "source", source: false } });
		await pause(250);
		const view = leaf.view, editor = view.editor, cm = editor.cm;
		const root = () => cm.dom.querySelector(".bbe-inline-editor");
		const child = selector => cm.constructor.findFromDOM(root().querySelector(selector));
		const press = (target, key, options = {}) => target.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
			key, code: key, bubbles: true, cancelable: true, ...options,
		}));
		const backwardInput = title => title.contentDOM.dispatchEvent(new InputEvent("beforeinput", {
			inputType: "deleteContentBackward", bubbles: true, cancelable: true,
		}));
		const text = "before\n\n> [!question]- Title\n> - [[Example note]]\n> \n\nafter";
		const open = async (value = text, needle = "Title") => {
			if (root()) { root().querySelector(":scope > .bbe-close").click(); await pause(); }
			cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: value }, selection: { anchor: 0 } });
			await pause();
			editor.setCursor(editor.offsetToPos(value.indexOf(needle) + 2)); editor.focus();
			await pause(250);
			assert(root()?.querySelector(".bbe-title-host .cm-editor"), "title editor missing");
			return { title: child(".bbe-title-host .cm-editor"), body: child(".bbe-editor-host > .markdown-source-view > .cm-editor") };
		};
		let { title, body } = await open();
		assert(title.hasFocus && title.state.selection.main.head === 2, "entering the header did not focus the title caret");
		assert(root().querySelector(".bbe-title-host > .markdown-source-view.mod-cm6 > .cm-editor") === title.dom,
			"title is not an Obsidian native Markdown editor");
		assert(app.workspace.activeEditor?.editor?.cm === title && app.workspace.activeEditor.file === file &&
			app.workspace.activeEditor.editMode.clipboardManager.getPath() === file.path,
			"title commands or clipboard manager lost the source file context");
		assert(title.dom.getBoundingClientRect().height >= title.defaultLineHeight &&
			getComputedStyle(title.scrollDOM).paddingTop === "0px" &&
			getComputedStyle(title.scrollDOM).lineHeight === getComputedStyle(root().querySelector(".callout-title")).lineHeight,
			"native title layout lost its height, spacing or callout typography");
		title.dispatch({ changes: { from: 0, to: 5, insert: "日本語タイトル" }, selection: { anchor: 4 } });
		await pause();
		assert(editor.getValue() === text.replace("Title", "日本語タイトル"), "title editing changed the list, blank line or folding marker");
		assert(cm.state.selection.main.head === editor.getValue().indexOf("日本語タイトル") + 4, "title source caret was not synchronized");
		press(title, "z", { ctrlKey: true }); await pause();
		assert(title.state.doc.toString() === "Title" && editor.getValue() === text, "title Undo did not reach the source");
		press(title, "y", { ctrlKey: true }); await pause();
		assert(editor.getValue().includes("日本語タイトル"), "title Redo did not reach the source: " + JSON.stringify({title:title.state.doc.toString(), source:editor.getValue(), focus:title.hasFocus, conflict:!!root()?.querySelector(".bbe-conflict")}));
		passed.push("header entry, Japanese title editing, exact body preservation, source caret and Undo/Redo");

		press(title, "Enter"); await pause();
		assert(body.hasFocus && body.state.doc.lineAt(body.state.selection.main.head).number === 1, "Enter did not move to the body");
		press(body, "ArrowUp"); await pause();
		assert(title.hasFocus && root(), "body first row did not move to title");
		title.dispatch({ selection: { anchor: title.state.doc.length } });
		press(title, "ArrowRight"); await pause();
		assert(body.hasFocus && body.state.doc.lineAt(body.state.selection.main.head).number === 1, "title end did not move to body start");
		press(body, "ArrowUp"); await pause();
		assert(title.hasFocus, "body first row did not move up to the title");
		title.dispatch({ selection: { anchor: 0 } }); press(title, "ArrowLeft"); await pause();
		assert(!root() && cm.hasFocus && cm.state.selection.main.head < editor.getValue().indexOf(">"), "title start did not exit above the callout");
		passed.push("outside/title/body navigation by arrows and Enter");

		({ title, body } = await open());
		title.dispatch({ selection: { anchor: 0 } });
		assert(!press(title, "Backspace") && !backwardInput(title), "backward deletion was not canceled at the title start");
		await pause();
		assert(root() && title.hasFocus && title.state.selection.main.head === 0 && editor.getValue() === text,
			"Backspace at the title start moved the caret or changed the note");
		title.dispatch({ selection: { anchor: 0, head: 1 } });
		assert(backwardInput(title), "beforeinput canceled deletion of selected title text");
		press(title, "Backspace"); await pause();
		assert(editor.getValue() === text.replace("Title", "itle"), "Backspace did not delete selected title text");
		passed.push("Backspace and beforeinput are canceled at the title start while selected text can still be deleted");

		({ title, body } = await open(text, "Example"));
		const retained = body;
		root().querySelector(".callout-title-inner").click(); await pause();
		assert(title.hasFocus, "clicking the title did not focus its editor");
		title.dispatch({ changes: { from: 0, to: title.state.doc.length, insert: "**Changed**" } }); await pause();
		press(title, "Enter"); await pause(300);
		assert(root().querySelector(".callout-title-inner strong")?.textContent === "Changed" && body === retained && body.hasFocus,
			"title preview did not render Markdown or body focus/history was lost: " + JSON.stringify({html:root().querySelector(".callout-title-inner")?.innerHTML,focus:body.hasFocus,title:title.state.doc.toString(),source:editor.getValue()}));
		const at = editor.getValue().indexOf("**Changed**");
		editor.replaceRange("Remote", editor.offsetToPos(at), editor.offsetToPos(at + 11)); await pause(300);
		assert(title.state.doc.toString() === "Remote" && root().querySelector(".callout-title-inner").textContent === "Remote", "external title change was not received");
		passed.push("click editing, Markdown preview on blur and incoming title edits retain the body editor");
		root().querySelector(".callout-title-inner").click(); await pause();
		const marker = editor.getValue().indexOf("[!question]-");
		editor.replaceRange("[!tip]+", editor.offsetToPos(marker), editor.offsetToPos(marker + 12)); await pause(300);
		assert(root().querySelector('.bbe-callout[data-callout="tip"]') && title.hasFocus && title.dom.isConnected && body.dom.isConnected,
			"incoming callout type change lost the active title editor");
		const headerFrom = editor.getValue().indexOf(">"), headerEnd = editor.getValue().indexOf("\n", headerFrom) + 1;
		editor.replaceRange("", editor.offsetToPos(headerFrom), editor.offsetToPos(headerEnd)); await pause(300);
		assert(root().querySelector(".bbe-blockquote") && !root().querySelector(".bbe-title-host") && body.hasFocus,
			"removing the callout header did not return focus to the retained body");
		passed.push("type changes retain title focus; removing a header returns focus to its body");

		({ title, body } = await open("> [!question]\n> body", "body"));
		body.dispatch({ selection: { anchor: 0 } }); body.focus(); press(body, "ArrowUp"); await pause();
		assert(title.hasFocus && title.state.doc.length === 0, "default title was not editable");
		assert(!press(title, "Backspace") && !backwardInput(title), "backward deletion was not canceled in the empty title");
		await pause();
		assert(title.hasFocus && editor.getValue() === "> [!question]\n> body", "Backspace in the empty title changed focus or source");
		title.dispatch({ changes: { from: 0, insert: "Custom" }, selection: { anchor: 6 } }); await pause();
		assert(editor.getValue() === "> [!question] Custom\n> body", "adding a missing title did not insert the separator");
		title.dispatch({ changes: { from: 0, to: 6, insert: "" } }); await pause();
		assert(editor.getValue() === "> [!question]\n> body", "clearing the title corrupted the header");
		passed.push("default and empty titles can be edited");

		({ title, body } = await open("> [!note] Title\n> body"));
		title.dispatch({ changes: { from: 0, to: 5, insert: "Longer 日本語 title" } }); await pause();
		const titleStart = editor.getValue().indexOf("Longer");
		cm.dispatch({ selection: { anchor: titleStart + 12, head: titleStart + 8 } }); cm.focus(); await pause();
		assert(title.hasFocus && title.state.selection.main.anchor === 12 && title.state.selection.main.head === 8,
			"incoming title selection was clamped to the old title length or lost its direction");
		press(title, "Enter"); await pause();
		body.dispatch({ selection: { anchor: 0 } }); body.focus(); press(body, "ArrowLeft"); await pause();
		assert(title.hasFocus && title.state.selection.main.head === title.state.doc.length, "plain body start did not move left to title end");
		passed.push("longer title offsets, backward source selections and horizontal body/title navigation");

		({ title, body } = await open("> [!note] Title"));
		press(title, "Enter"); await pause();
		assert(body.hasFocus && body.state.doc.length === 0, "header-only callout had no editable body");
		body.dispatch({ changes: { from: 0, insert: "new body" } }); await pause();
		assert(editor.getValue() === "> [!note] Title\n> new body", "header-only body edit damaged the title");
		passed.push("header-only callouts support navigation and adding a body");

		({ title, body } = await open("> [!note] Outer\n> start\n>\n> > [!tip] Title\n> > body", "start"));
		body.dispatch({ selection: { anchor: body.state.doc.toString().indexOf("body") } }); body.focus(); await pause(300);
		const innerRoot = body.dom.querySelector(".bbe-inline-editor");
		const innerBody = cm.constructor.findFromDOM(innerRoot.querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"));
		const innerTitle = cm.constructor.findFromDOM(innerRoot.querySelector(".bbe-title-host .cm-editor"));
		innerBody.dispatch({ selection: { anchor: 0 } }); innerBody.focus(); press(innerBody, "ArrowUp"); await pause();
		assert(innerTitle.hasFocus, "nested body did not move to its own title");
		innerTitle.dispatch({ changes: { from: 0, to: 5, insert: "Nested title" } }); await pause();
		assert(editor.getValue().includes("> > [!tip] Nested title\n> > body"), "nested title did not synchronize through every ancestor");
		passed.push("nested title navigation and synchronization through enclosing editors");

		({ title, body } = await open("> [!note] Title\n> body"));
		title.dispatch({ selection: { anchor: 0, head: title.state.doc.length } });
		app.commands.executeCommandById("editor:toggle-bold"); await pause();
		assert(title.state.doc.toString() === "**Title**" && editor.getValue() === "> [!note] **Title**\n> body" &&
			title.dom.querySelector(".cm-strong"), "native title formatting command or Live Preview failed");
		const owner = app.workspace.activeEditor;
		owner.editor.undo(); await pause();
		assert(title.state.doc.toString() === "Title" && editor.getValue() === "> [!note] Title\n> body",
			"native title Undo failed");
		title.dispatch({ changes: { from: 0, to: title.state.doc.length, insert: "[[" + target.basename },
			selection: { anchor: target.basename.length + 2 }, userEvent: "input.type" });
		const deadline = Date.now() + 4000;
		while (owner.editMode.editorSuggest.currentSuggest?.context?.query !== target.basename && Date.now() < deadline) await pause();
		const suggest = owner.editMode.editorSuggest.currentSuggest;
		assert(suggest?.context?.query === target.basename && suggest.context.file === file && suggest.context.editor === owner.editor,
			"native title link suggestions did not use the source file and editor");
		const choices = await suggest.getSuggestions(suggest.context);
		const choice = choices?.find(item => item.file === target);
		assert(choice, "title link completion target missing");
		press(title, "Enter"); await pause();
		assert(title.hasFocus && title.state.doc.toString().includes(target.basename + "]]") &&
			editor.getValue() === "> [!note] " + title.state.doc.toString() + "\n> body", "title link completion did not synchronize");
		const singleLine = title.state.doc.toString();
		const source = editor.getValue();
		title.dispatch({ changes: { from: 0, insert: "first\nsecond" } }); await pause();
		assert(title.state.doc.toString() === singleLine && editor.getValue() === source,
			"multiline input corrupted the callout title");
		passed.push("native title formatting, Live Preview, Undo, file-aware link completion and single-line input");

		({ title, body } = await open());
		title.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
		title.dispatch({ changes: { from: 0, insert: "日本語" } });
		press(title, "ArrowUp"); await pause();
		assert(root() && title.compositionStarted, "arrow navigation interrupted composition");
		title.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })); await pause(300);
		assert(editor.getValue().includes("日本語Title"), "composition text was lost");
		passed.push("title composition is preserved during navigation");

		({ title, body } = await open());
		title.dispatch({ changes: { from: 0, to: 5, insert: "Local" } });
		const start = editor.getValue().indexOf("Title");
		editor.replaceRange("Remote", editor.offsetToPos(start), editor.offsetToPos(start + 5)); await pause();
		assert(root().querySelector(".bbe-conflict") && title.state.doc.toString() === "Local" && editor.getValue().includes("Remote"),
			"overlapping title edits discarded a version");
		passed.push("concurrent overlapping title edits preserve both versions and pause synchronization");
		return JSON.stringify({ passed });
	} finally {
		if (typeof leaf.view.save === "function") await leaf.view.save();
		leaf.detach(); await pause(300);
		if (app.vault.getAbstractFileByPath(file.path) === file) await app.vault.delete(file);
		if (app.vault.getAbstractFileByPath(target.path) === target) await app.vault.delete(target);
		if (originalLeaf) app.workspace.setActiveLeaf(originalLeaf, { focus: true });
	}
})()
