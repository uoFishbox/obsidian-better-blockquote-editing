// Run through Obsidian CLI eval. Only the two uniquely named scratch notes are changed.
(async () => {
	const pause = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));
	const assert = (condition, message) => { if (!condition) throw new Error(message); };
	const originalLeaf = app.workspace.activeLeaf;
	require("electron").remote.getCurrentWindow().focus();
	const initial = "before\n\n> [!note]- 日本語タイトル\n> body\n>\n> tail\n\nend";
	const id = Date.now();
	const file = await app.vault.create(`bbe-smoke-${id}.md`, initial);
	const other = await app.vault.create(`bbe-smoke-${id}-other.md`, "other note");
	const leaf = app.workspace.getLeaf("tab");
	const passed = [];
	try {
		await leaf.openFile(file, { state: { mode: "source", source: false } });
		await pause(200);
		let view = leaf.view;
		let editor = view.editor;
		let cm = editor.cm;
		const root = () => cm.dom.querySelector(".bbe-inline-editor");
		const child = () => cm.constructor.findFromDOM(root().querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"));
		const close = async () => {
			root().querySelector(":scope > .bbe-close").click();
			await pause();
			assert(!root(), "close button left an editor open: " + JSON.stringify({
				text:editor.getValue(),active:document.activeElement?.className,
				buttons:[...(root()?.querySelectorAll("button") ?? [])].map(button=>button.className),
			}));
		};
		const open = async (needle = "body") => {
			editor.setCursor(editor.offsetToPos(editor.getValue().indexOf(needle)));
			app.workspace.setActiveLeaf(leaf, { focus: true });
			editor.focus();
			await pause();
			// Windows can deny foreground activation by background CLI processes.
			app.workspace.activeEditor = view;
			const command = app.commands.commands["obsidian-better-blockquote-editing:edit-quote-inline"];
			if (!root()) assert(command.editorCheckCallback(false, editor, view), "editor command unavailable for fixture");
			await pause();
			assert(root(), "inline editor missing: " + JSON.stringify({passed, cursor:editor.getCursor(),
				text:editor.getValue().slice(0,200),target:!!app.plugins.plugins["obsidian-better-blockquote-editing"].getTarget(editor),
				state:cm.state.values.filter(value=>value&&typeof value==="object"&&"widget" in value)
					.map(value=>({from:value.from,to:value.to,conflict:value.conflict})),html:cm.contentDOM.outerHTML.slice(-1200)}));
			assert(child() !== cm, "native editor must have its own CM instance");
			return child();
		};
		for (const header of ["[!note] Title", "[!tip] **Title**", "[!custom-type|wide] Custom"]) {
			const text = `before\n\n> ${header}\n> body\n\nafter`;
			cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: text }, selection: { anchor: 0 } });
			await pause();
			const native = cm.dom.querySelector(".cm-callout .callout");
			assert(native, "native callout fixture missing");
			const expected = {
				type: native.dataset.callout, metadata: native.dataset.calloutMetadata,
				title: native.querySelector(".callout-title-inner").innerHTML,
				background: getComputedStyle(native).backgroundColor,
				height: native.getBoundingClientRect().height,
			};
			const embedded = await open();
			const shell = root().querySelector(".bbe-callout");
			assert(shell && shell.dataset.callout === expected.type && shell.dataset.calloutMetadata === expected.metadata &&
				shell.querySelector(".callout-title-inner").innerHTML === expected.title &&
				getComputedStyle(shell).backgroundColor === expected.background,
				"embedded callout differs from native type, metadata, Markdown title or color: " + JSON.stringify({expected,
					actual: shell && {type:shell.dataset.callout,metadata:shell.dataset.calloutMetadata,
						title:shell.querySelector(".callout-title-inner").innerHTML,background:getComputedStyle(shell).backgroundColor}}));
			assert(shell.querySelector(".callout-content .bbe-editor-host > .markdown-source-view > .cm-editor"), "editor is outside the callout body");
			const shortHeight = shell.getBoundingClientRect().height;
			assert(Math.abs(shortHeight - expected.height) < 8, "one-line editor does not match native height: " +
				JSON.stringify({ shortHeight, nativeHeight: expected.height, html: root().innerHTML }));
			assert(root().querySelector(".bbe-status").hidden, "normal status takes up space");
			const content = shell.querySelector(".callout-content");
			assert(getComputedStyle(content).overflowY === "visible" || content.scrollHeight <= content.clientHeight + 1,
				"one-line callout has an internal vertical scrollbar");
			embedded.dispatch({ changes: { from: 0, to: embedded.state.doc.length, insert: "body\n".repeat(10) } });
			await pause();
			assert(shell.getBoundingClientRect().height > shortHeight + 100, "editor did not grow with its content");
			embedded.dispatch({ changes: { from: 0, to: embedded.state.doc.length, insert: "" } });
			await pause();
			assert(shell.getBoundingClientRect().height <= shortHeight + 2 && embedded.contentDOM.getBoundingClientRect().height > 0,
				"empty editor did not shrink to an editable line");
			await close();
		}
		passed.push("native callout types, metadata, Markdown titles and colors are retained; height grows and shrinks with content");
		{
			const source = false;
			await view.setState({ ...view.getState(), mode: "source", source }, { history: false });
			for (const block of ["> body", "> [!note] Title\n> body"]) {
				const text = "outside\n\n" + block + "\n\nafter";
				cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: text }, selection: { anchor: 0 } });
				cm.focus();
				await pause();
				assert(!root(), "caret outside a quote opened an editor");
				const at = text.indexOf("body") + 2;
				cm.dispatch({ selection: { anchor: at }, userEvent: "select" });
				await pause();
				assert(root() && child().state.doc.toString() === "body", "caret entry did not open the correct body: " + JSON.stringify({
					source,block,hasRoot:!!root(),body:root()&&child().state.doc.toString(),focus:cm.hasFocus,
					documentFocus:document.hasFocus(),head:cm.state.selection.main.head,active:document.activeElement?.className,
				}));
				assert(child().state.selection.main.head === 2, "auto-open lost the caret offset");
				await close();
				assert(!root(), "closing immediately reopened the editor");
				cm.contentDOM.blur();
				cm.focus();
				await pause();
				assert(!root(), "refocusing after close reopened the editor without a caret move");
				const command = app.commands.commands["obsidian-better-blockquote-editing:edit-quote-inline"];
				cm.dispatch({ selection: { anchor: at } });
				assert(command.editorCheckCallback(false, editor, view), "explicit command failed after auto-open was dismissed");
				await pause();
				assert(root(), "explicit command did not reopen the editor");
				await close();
				cm.dispatch({ selection: { anchor: 0 } });
				cm.dispatch({ selection: { anchor: at, head: at + 1 } });
				await pause();
				assert(!root(), "range selection opened an editor");
				const Selection = cm.state.selection.constructor;
				cm.dispatch({ selection: Selection.create([Selection.cursor(0), Selection.cursor(at)]) });
				await pause();
				assert(!root(), "multiple carets opened an editor");
				cm.dispatch({ selection: { anchor: at } });
				cm.dispatch({ selection: { anchor: 0 } });
				await pause();
				assert(!root(), "stale queued caret position opened an editor");
				cm.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
				cm.dispatch({ selection: { anchor: at } });
				await pause();
				assert(!root(), "auto-open interrupted composition");
				cm.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
				for (let retry = 0; retry < 20 && !root()?.querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"); retry++) await pause(50);
				assert(root(), "auto-open did not resume after composition ended");
				await close();
				cm.dispatch({ selection: { anchor: 0 } });
				cm.contentDOM.blur();
				cm.dispatch({ selection: { anchor: at } });
				await pause();
				assert(!root(), "an unfocused editor opened automatically");
				cm.focus();
				await pause();
				assert(root(), "focusing a caret inside a quote did not open the editor");
				await close();
			}
		}
		passed.push("caret entry and focus open quotes/callouts in Live Preview, preserving offsets and respecting close, selections, IME and focus");
		const press = (target, key, options = {}) => target.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
			key, code: key, bubbles: true, cancelable: true, ...options,
		}));
		{
			const source = false;
			await view.setState({ ...view.getState(), mode: "source", source }, { history: false });
			for (const block of ["> body\n> last", "> [!note] Title\n> body\n> last"]) {
				const text = "before\n\n" + block + "\n\nafter";
				const load = async () => {
					cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: text }, selection: { anchor: 0 } });
					cm.focus();
					await pause();
					return open();
				};
				for (const direction of [-1, 1]) {
					let embedded = await load();
					embedded.dispatch({ changes: { from: 0, insert: "pending " } });
					// Place the outer caret as a mouse click would, while the live sync is pending.
					cm.dispatch({ selection: { anchor: direction < 0 ? 0 : cm.state.doc.length } });
					cm.focus();
					await pause();
					assert(!root(), "moving the outer caret outside did not close the editor: " + JSON.stringify({
						source, block, direction, focus: cm.hasFocus, head: cm.state.selection.main.head, active: document.activeElement?.className,
					}));
					const expected = text.replace("> body", "> pending body");
					assert(editor.getValue() === expected, "auto-close lost pending edits");
					assert(cm.state.selection.main.head === (direction < 0 ? expected.indexOf(">") - 1 : expected.indexOf("\n\nafter") + 1),
						"auto-close did not place the caret on the adjacent outside line");
					assert(cm.hasFocus, "auto-close did not restore parent focus");
					for (const key of direction < 0 ? ["ArrowUp", "ArrowLeft"] : ["ArrowDown", "ArrowRight"]) {
						embedded = await load();
						embedded.dispatch({ selection: { anchor: direction < 0 ? 0 : embedded.state.doc.length } });
						embedded.focus();
						press(embedded, key);
						await pause();
						if (direction < 0 && block.includes("[!")) {
							const title = cm.constructor.findFromDOM(root().querySelector(".bbe-title-host .cm-editor"));
							assert(title.hasFocus, key + " did not stop at the callout title");
							title.dispatch({ selection: { anchor: 0 } });
							press(title, key);
							await pause();
						}
						assert(!root(), key + " at the editor edge did not close it");
						assert(editor.getValue() === text, "exiting changed a block with existing outside lines");
						assert(cm.state.selection.main.head === (direction < 0 ? text.indexOf(">") - 1 : text.indexOf("\n\nafter") + 1),
							key + " placed the caret inside the block");
					}
				}
				let embedded = await load();
				embedded.dispatch({ selection: { anchor: 2 } });
				embedded.focus();
				press(embedded, "ArrowDown");
				await pause();
				assert(root() && child() === embedded, "normal arrow movement inside closed the editor");
				embedded.dispatch({ selection: { anchor: 0, head: 2 } });
				press(embedded, "ArrowUp", { shiftKey: true });
				await pause();
				assert(root(), "selection extension closed the editor");
				await close();
				assert(cm.state.selection.main.head === text.indexOf("\n\nafter") + 1, "close button did not move below the block");
			}
		}
		passed.push("outside caret and boundary arrows close quotes/callouts in Live Preview, flush pending edits and place the caret above/below");
		for (const direction of [-1, 1]) {
			const text = "> body";
			cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: text }, selection: { anchor: 3 } });
			cm.focus();
			await pause();
			const embedded = child();
			embedded.dispatch({ selection: { anchor: direction < 0 ? 0 : embedded.state.doc.length } });
			press(embedded, direction < 0 ? "ArrowUp" : "ArrowDown");
			await pause();
			assert(!root(), "document-edge exit did not close");
			assert(editor.getValue() === (direction < 0 ? "\n" + text : text + "\n\n"), "document-edge exit did not create an outside line");
			assert(cm.state.selection.main.head === (direction < 0 ? 0 : text.length + 2), "document-edge caret is still inside the quote");
		}
		passed.push("exiting at document boundaries creates an outside line on the requested side");
		cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: initial }, selection: { anchor: 0 } });
		await view.setState({ ...view.getState(), mode: "source", source: false }, { history: false });
		let embedded = await open();
		assert(embedded.state.doc.toString() === "body\n\ntail", "prefixes or header leaked into body: " + embedded.state.doc.toString());
		const layoutDeadline = Date.now() + 1500;
		while (embedded.dom.getBoundingClientRect().height < embedded.defaultLineHeight && Date.now() < layoutDeadline) await pause();
		assert(embedded.dom.getBoundingClientRect().height >= embedded.defaultLineHeight, "native editor is not visible: " +
			JSON.stringify({sameLeaf:app.workspace.activeLeaf===leaf,rootHeight:root().getBoundingClientRect().height,
				nativeHeight:embedded.dom.getBoundingClientRect().height,parentHeight:cm.dom.getBoundingClientRect().height}));
		assert(app.workspace.activeEditor?.editor?.cm === embedded, "native editor isn't the command target");
		const nativeEditor = app.workspace.activeEditor.editor;
		passed.push("native Markdown editor mounts inline with focus and no quote markers");

		embedded.dispatch({ changes: { from: 0, to: embedded.state.doc.length, insert: "本文\n\n- item\n> nested" } });
		const nativeSelection = embedded.state.selection.main.head;
		await pause();
		const live = "before\n\n> [!note]- 日本語タイトル\n> 本文\n> \n> - item\n> > nested\n\nend";
		assert(editor.getValue() === live, "source was not updated before closing: " + editor.getValue());
		assert(root() && child() === embedded, "sync remounted the editor");
		assert(app.workspace.activeEditor?.editor?.cm === embedded, "sync stole focus");
		assert(embedded.state.selection.main.head === nativeSelection, "sync changed the native selection");
		passed.push("each edit updates the source while preserving native instance, focus and selection");

		nativeEditor.undo();
		await pause();
		assert(embedded.state.doc.toString() === "body\n\ntail" && editor.getValue() === initial, "native Undo was not mirrored");
		nativeEditor.redo();
		await pause();
		assert(editor.getValue() === live, "native Redo was not mirrored");
		await close();
		assert(!root() && editor.getValue() === live, "close changed or reverted source");
		editor.undo();
		await pause();
		assert(editor.getValue() === initial, "parent Undo after closing failed");
		passed.push("native Undo/Redo synchronizes; closing keeps edits and parent Undo works");

		embedded = await open();
		embedded.dispatch({ changes: { from: 0, insert: "live " } });
		await pause();
		editor.replaceRange("prefix\n", { line: 0, ch: 0 });
		await pause();
		embedded.dispatch({ changes: { from: embedded.state.doc.length, insert: "\nlast" } });
		await pause();
		assert(child() === embedded && !root().querySelector(".bbe-conflict"), "unrelated edit caused a conflict or remount");
		assert(editor.getValue().startsWith("prefix\nbefore") && editor.getValue().includes("> live body") &&
			editor.getValue().includes("> last"), "range mapping after unrelated edit failed");
		await close();
		passed.push("unrelated source edits preserve continuous synchronization");

		embedded = await open();
		const offset = editor.getValue().indexOf("live body");
		embedded.dispatch({ changes: { from: 0, to: "live body".length, insert: "unsynced local" } });
		editor.replaceRange("external", editor.offsetToPos(offset), editor.offsetToPos(offset + "live body".length));
		await pause();
		assert(root().querySelector(".bbe-conflict"), "source conflict did not stop synchronization");
		assert(editor.getValue().includes("> external") && !editor.getValue().includes("unsynced"), "external edit was overwritten");
		assert(embedded.state.doc.toString().includes("unsynced"), "conflict discarded native text");
		cm.dispatch({ selection: { anchor: cm.state.doc.length } });
		cm.focus();
		await pause();
		assert(root() && child().state.doc.toString().includes("unsynced"), "automatic exit discarded conflicted text");
		await close();
		passed.push("overlapping pending and external replacements stop synchronization without overwriting either version");

		{
			const source = false;
			await view.setState({ ...view.getState(), mode: "source", source }, { history: false });
			editor.setValue("> body\n>\n> tail");
			await pause();
			embedded = await open();
			embedded.dispatch({ changes: { from: 0, to: 4, insert: "changed" } });
			await pause();
			assert(editor.getValue() === "> changed\n> \n> tail", "plain quote live sync failed");
			await close();
		}
		passed.push("plain quotes sync in Live Preview");

		editor.setValue("> body");
		await pause();
		embedded = await open();
		embedded.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
		embedded.dispatch({ changes: { from: 0, insert: "に" } });
		await pause(20);
		embedded.dispatch({ changes: { from: 0, to: 1, insert: "日本語" } });
		await pause(20);
		assert(embedded.compositionStarted && child() === embedded && editor.getValue() === "> 日本語body", "composition updates disrupted the editor or synchronization: " +
			JSON.stringify({compositionStarted:embedded.compositionStarted,same:child()===embedded,source:editor.getValue(),native:embedded.state.doc.toString()}));
		root().querySelector(":scope > .bbe-close").click();
		await pause(20);
		assert(root(), "close interrupted composition");
		embedded.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本語" }));
		await pause();
		await close();
		assert(!root() && editor.getValue() === "> 日本語body\n\n", "composition text was lost on close");
		passed.push("simulated composition stays active during live sync and prevents premature closing");
		cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: "before\n\n> body\n\nafter" }, selection: { anchor: 0 } });
		embedded = await open();
		embedded.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
		cm.dispatch({ selection: { anchor: cm.state.doc.length } });
		cm.focus();
		await pause();
		assert(root(), "outside caret closed the editor during composition");
		embedded.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
		await pause();
		assert(!root() && cm.state.selection.main.head === editor.getValue().indexOf("\n\nafter") + 1,
			"outside caret exit did not resume after composition ended");
		passed.push("automatic exit preserves conflicted drafts and waits until composition ends");

		const wrappedText = "before\n\n> " + "wrapped text ".repeat(100) + "\n\nafter";
		cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: wrappedText }, selection: { anchor: 0 } });
		embedded = await open("wrapped");
		await pause();
		let middle = 0;
		const firstRowTop = embedded.coordsAtPos(0).top;
		for (let at = 1; at < embedded.state.doc.length; at++) {
			const coords = embedded.coordsAtPos(at);
			if (coords && coords.top > firstRowTop + 1) { middle = at; break; }
		}
		assert(middle > 0, "wrapped-line fixture did not wrap");
		embedded.dispatch({ selection: { anchor: middle } });
		embedded.focus();
		press(embedded, "ArrowUp");
		await pause();
		assert(root(), "moving between wrapped rows closed the editor");
		await close();
		passed.push("arrow navigation across wrapped rows keeps the editor open");

		const nested = "> [!note] Outer\n> start\n>\n> > [!tip] Inner\n> > body\n>\n> end";
		await view.setState({ ...view.getState(), mode: "source", source: false }, { history: false });
		editor.setValue(nested);
		await pause();
		embedded = await open("start");
		const outerRoot = root();
		const nestedAt = embedded.state.doc.toString().indexOf("body");
		embedded.dispatch({ selection: { anchor: nestedAt } });
		embedded.focus();
		await pause();
		const innerRoot = embedded.dom.querySelector(".bbe-inline-editor");
		assert(innerRoot, "nested native editor missing");
		const inner = embedded.constructor.findFromDOM(innerRoot.querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"));
		inner.dispatch({ changes: { from: 0, to: 4, insert: "nested changed" } });
		await pause();
		assert(editor.getValue().includes("> > nested changed"), "inner edits didn't reach the file while both editors were open: " + JSON.stringify({source:editor.getValue(),outer:embedded.state.doc.toString(),inner:inner.state.doc.toString(),conflict:!!root().querySelector(".bbe-conflict")}));
		assert(child() === embedded && embedded.constructor.findFromDOM(innerRoot.querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor")) === inner,
			"nested synchronization recreated an editor: " + JSON.stringify({outer:child()===embedded,
				inner:embedded.constructor.findFromDOM(innerRoot.querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"))===inner,
				rootConnected:outerRoot.isConnected,innerConnected:innerRoot.isConnected,
				queriedIsOuter:root().querySelector(".cm-content")===embedded.contentDOM,
				foundDoc:child().state.doc.toString(),innerText:inner.state.doc.toString(),outerText:embedded.state.doc.toString()}));
		inner.dispatch({ changes: { from: inner.state.doc.length, insert: " latest" } });
		inner.dispatch({ selection: { anchor: inner.state.doc.length } });
		inner.focus();
		press(inner, "ArrowDown");
		await pause();
		assert(root() === outerRoot && !embedded.dom.querySelector(".bbe-inline-editor"), "leaving an inner editor closed its ancestor");
		assert(embedded.state.selection.main.head === embedded.state.doc.toString().indexOf("\n\nend") + 1,
			"leaving an inner editor did not place the caret below its block");
		assert(editor.getValue().includes("> > nested changed latest"), "inner exit lost pending edits");
		embedded.dispatch({ selection: { anchor: embedded.state.doc.toString().indexOf("nested changed") } });
		await pause();
		const reopenedRoot = embedded.dom.querySelector(".bbe-inline-editor");
		assert(reopenedRoot, "inner editor did not reopen after caret re-entry");
		const reopened = embedded.constructor.findFromDOM(reopenedRoot.querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"));
		reopened.dispatch({ changes: { from: reopened.state.doc.length, insert: " pending" } });
		outerRoot.querySelector(":scope > .bbe-close").click();
		await pause();
		assert(!root() && editor.getValue().includes("> > nested changed latest pending"), "closing an ancestor lost a pending nested update");
		passed.push("nested exit keeps its ancestor open and propagates edits; ancestor close flushes pending edits");

		editor.setValue("> body\n\n" + "outside\n".repeat(2000));
		await pause();
		embedded = await open();
		const retained = root();
		embedded.dispatch({ changes: { from: 0, insert: "retained " } });
		await pause();
		cm.scrollDOM.scrollTop = cm.scrollDOM.scrollHeight;
		cm.requestMeasure();
		await pause(200);
		cm.scrollDOM.scrollTop = 0;
		cm.requestMeasure();
		await pause(200);
		assert(root() === retained && child() === embedded && editor.getValue().startsWith("> retained body"), "scrolling lost the live editor or source");
		await close();
		passed.push("scrolling retains native editor state and synchronized text");

		editor.setValue("> [!tip] Button\n> body\n\noutside");
		editor.setCursor(editor.offsetToPos(editor.getValue().length));
		await pause();
		const button = cm.dom.querySelector(".cm-callout .edit-block-button");
		assert(button, "native callout edit button missing");
		button.click();
		await pause();
		embedded = child();
		embedded.dispatch({ changes: { from: 0, insert: "keyboard " } });
		await pause();
		embedded.focus();
		embedded.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
		await pause();
		assert(!root() && editor.getValue().includes("> keyboard body"), "Escape reverted a live edit");
		embedded = await open();
		const isMac = /Mac/.test(navigator.platform);
		embedded.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
			key: "Enter", code: "Enter", ctrlKey: !isMac, metaKey: isMac, bubbles: true, cancelable: true,
		}));
		await pause();
		assert(!root(), "Mod+Enter did not close");
		passed.push("native button opens the editor; Escape and Mod+Enter close without reverting edits");

		embedded = await open();
		embedded.dispatch({ changes: { from: 0, insert: "persisted " } });
		await pause();
		const saveDeadline = Date.now() + 5000;
		while (!(await app.vault.read(file)).includes("> persisted keyboard body") && Date.now() < saveDeadline) await pause();
		assert((await app.vault.read(file)).includes("> persisted keyboard body"), "live changes were not written to the file");
		await leaf.openFile(other, { state: { mode: "source", source: false } });
		await pause(200);
		view = leaf.view;
		editor = view.editor;
		cm = editor.cm;
		assert(editor.getValue() === "other note" && !root(), "file switch retained an old editing session");
		assert((await app.vault.read(file)).includes("> persisted keyboard body"), "switching files lost live changes");
		passed.push("live text reaches the file and survives switching notes without closing the editor");
		return JSON.stringify({ passed });
	} finally {
		if (typeof leaf.view.save === "function") await leaf.view.save();
		leaf.detach();
		await pause(500);
		for (const scratch of [file, other]) {
			if (app.vault.getAbstractFileByPath(scratch.path)) await app.vault.delete(scratch);
		}
		if (originalLeaf) app.workspace.setActiveLeaf(originalLeaf, { focus: true });
	}
})()
