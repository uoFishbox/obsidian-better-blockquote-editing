// Run through Obsidian CLI eval. Only this temporary note is changed.
(async () => {
	const pause = (ms = 150) => new Promise(resolve => setTimeout(resolve, ms));
	const assert = (ok, message) => { if (!ok) throw new Error(message); };
	const originalLeaf = app.workspace.activeLeaf;
	const file = await app.vault.create(`bbe-blockquote-${Date.now()}.md`, "");
	const leaf = app.workspace.getLeaf("tab");
	const passed = [];
	try {
		require("electron").remote.getCurrentWindow().focus();
		await leaf.openFile(file, { state: { mode: "source", source: false } });
		app.workspace.setActiveLeaf(leaf, { focus: true });
		await pause(750);
		const view = leaf.view, editor = view.editor, cm = editor.cm;
		const root = () => cm.dom.querySelector(".bbe-inline-editor");
		const bodyEditor = () => {
			const dom = root()?.querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor");
			return dom ? cm.constructor.findFromDOM(dom) : null;
		};
		const close = async () => {
			root()?.querySelector(":scope > .bbe-close").click();
			await pause();
		};
		const load = async block => {
			await close();
			const text = `before\n\n${block}\n\nafter`;
			cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: text }, selection: { anchor: 0 } });
			cm.focus(); await pause();
			for (let retry = 0; retry < 30 && !cm.contentDOM.querySelector(".HyperMD-quote")?.getBoundingClientRect().height; retry++) await pause(50);
			return text;
		};
		const open = async text => {
			cm.dispatch({ selection: { anchor: text.indexOf(">") + 2 } });
			cm.focus(); await pause();
			assert(root() && bodyEditor(), "entering the quote did not open its native body editor");
			return bodyEditor();
		};
		for (const customTheme of [false, true]) {
			if (customTheme) {
				for (const [key, value] of Object.entries({
					"--blockquote-border-thickness": "3px", "--blockquote-border-color": "rgb(50, 100, 150)",
					"--blockquote-background-color": "rgb(245, 240, 230)", "--blockquote-style": "italic", "--blockquote-size": "20px",
				})) view.containerEl.style.setProperty(key, value);
			}
			const text = await load("> test\n> second");
			const native = cm.contentDOM.querySelector(".HyperMD-quote");
			const rail = getComputedStyle(native, "::before");
			const expected = { border: rail.borderInlineStart, background: getComputedStyle(native).backgroundColor,
				fontSize: getComputedStyle(native).fontSize, fontStyle: getComputedStyle(native).fontStyle,
				height: native.getBoundingClientRect().height * 2 };
			assert(expected.height > 0 && parseFloat(rail.borderInlineStartWidth) > 0, "native quote fixture is not visible: " + JSON.stringify({ expected,
				active: app.workspace.activeLeaf === leaf, html: cm.contentDOM.outerHTML.slice(0, 1600), container: cm.dom.getBoundingClientRect().toJSON() }));
			const embedded = await open(text);
			const shell = root().querySelector(".bbe-blockquote"), style = getComputedStyle(shell);
			assert(getComputedStyle(shell, "::before").borderInlineStart === expected.border && style.backgroundColor === expected.background,
				"editing lost the native quote rail or background: " + JSON.stringify({ expected, border: getComputedStyle(shell, "::before").borderInlineStart, background: style.backgroundColor }));
			assert(getComputedStyle(embedded.contentDOM).fontSize === expected.fontSize &&
				getComputedStyle(embedded.contentDOM).fontStyle === expected.fontStyle,
				"editing lost the theme's quote typography: " + JSON.stringify({ expected, customTheme,
					shell: [style.fontSize, style.fontStyle], body: [getComputedStyle(embedded.contentDOM).fontSize, getComputedStyle(embedded.contentDOM).fontStyle] }));
			assert(Math.abs(root().getBoundingClientRect().height - expected.height) < 2,
				"editing added vertical space around the quote: " + JSON.stringify({ expected, height: root().getBoundingClientRect().height }));
			assert(getComputedStyle(shell.querySelector(".bbe-editor-host")).marginBlockStart === "0px" &&
				getComputedStyle(shell.querySelector(".bbe-editor-host")).marginBlockEnd === "0px", "quote body has paragraph margins");
			assert(embedded.state.doc.toString() === "test\nsecond" && !embedded.contentDOM.querySelector(".cm-formatting-quote") &&
				cm.state.doc.toString() === text, "opening exposed quote markers or changed the source");
			await close();
		}
		for (const key of ["--blockquote-border-thickness", "--blockquote-border-color", "--blockquote-background-color", "--blockquote-style", "--blockquote-size"])
			view.containerEl.style.removeProperty(key);
		passed.push("editing preserves the native rail, background, typography and height with the current theme and custom theme variables");

		let text = await load("> test");
		const nativeText = cm.contentDOM.querySelector(".cm-quote:not(.cm-formatting)");
		const bounds = nativeText.getBoundingClientRect();
		for (const type of ["mousedown", "mouseup", "click"]) nativeText.dispatchEvent(new MouseEvent(type, {
			bubbles: true, cancelable: true, button: 0, detail: 1, buttons: type === "mousedown" ? 1 : 0,
			clientX: bounds.left + 10, clientY: bounds.top + bounds.height / 2,
		}));
		await pause(300);
		assert(root() && bodyEditor().hasFocus && editor.getValue() === text, "clicking quote text did not focus the body without changing the source: " +
			JSON.stringify({ root: !!root(), focused: bodyEditor()?.hasFocus, parentFocus: cm.hasFocus, bounds: bounds.toJSON(), selection: cm.state.selection.toJSON(), text: editor.getValue() }));
		passed.push("clicking the displayed quote opens the body editor without exposing outer Markdown markers");

		let embedded = bodyEditor();
		const retained = root(), shell = root().querySelector(".bbe-blockquote");
		const shortHeight = shell.getBoundingClientRect().height;
		embedded.dispatch({ changes: { from: 0, to: embedded.state.doc.length, insert: "日本語\n\nsecond" }, selection: { anchor: 3 } });
		await pause();
		assert(editor.getValue().includes("> 日本語\n> \n> second") && root() === retained && bodyEditor() === embedded,
			"multiline input lost source markers or remounted the editor");
		assert(shell.getBoundingClientRect().height > shortHeight + 30, "rail did not grow with multiline text");
		embedded.dispatch({ changes: { from: 0, to: embedded.state.doc.length, insert: "" } });
		await pause();
		assert(Math.abs(shell.getBoundingClientRect().height - shortHeight) < 2 && embedded.contentDOM.getBoundingClientRect().height > 0 &&
			editor.getValue().includes("\n> \n"), "empty quote did not retain a single editable line and rail");
		const long = "折り返しの引用文です。".repeat(30);
		embedded.dispatch({ changes: { from: 0, insert: long } });
		await pause();
		assert(shell.getBoundingClientRect().height > shortHeight * 2 && embedded.scrollDOM.scrollWidth <= embedded.scrollDOM.clientWidth + 1,
			"long quote did not wrap inside its rail");
		embedded.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
		await pause();
		assert(!root() && editor.getValue().includes("> " + long), "Escape lost the quote text or left the editor open");
		passed.push("Japanese text, newlines, blank lines, empty quotes, wrapping and Escape retain the source and resize the rail");

		text = await load("> outer\n>\n> > inner\n>\n> tail");
		embedded = await open(text);
		embedded.dispatch({ selection: { anchor: embedded.state.doc.toString().indexOf("inner") + 2 } });
		embedded.focus(); await pause(300);
		const innerRoot = embedded.dom.querySelector(".bbe-inline-editor");
		assert(innerRoot?.querySelector(".bbe-blockquote"), "nested quote editor missing");
		assert(parseFloat(getComputedStyle(innerRoot.querySelector(".bbe-blockquote"), "::before").borderInlineStartWidth) > 0 &&
			parseFloat(getComputedStyle(root().querySelector(".bbe-blockquote"), "::before").borderInlineStartWidth) > 0,
			"nested editing lost an enclosing quote rail");
		const inner = cm.constructor.findFromDOM(innerRoot.querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"));
		inner.dispatch({ changes: { from: 0, insert: "nested " } });
		await pause();
		assert(editor.getValue().includes("> > nested inner"), "nested body did not reach the original note");
		passed.push("nested quotes retain both rails and synchronize through the enclosing editor");
		return JSON.stringify({ passed });
	} catch (error) {
		throw new Error(`${error.stack}\nCompleted: ${JSON.stringify(passed)}`);
	} finally {
		if (typeof leaf.view.save === "function") await leaf.view.save();
		leaf.detach(); await pause(300);
		if (app.vault.getAbstractFileByPath(file.path) === file) await app.vault.delete(file);
		if (originalLeaf) app.workspace.setActiveLeaf(originalLeaf, { focus: true });
	}
})()
