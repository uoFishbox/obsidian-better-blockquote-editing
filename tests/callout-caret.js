// Run through Obsidian CLI eval. Only this temporary note is changed.
(async () => {
	const pause = (ms = 150) => new Promise(resolve => setTimeout(resolve, ms));
	const assert = (ok, message) => { if (!ok) throw new Error(message); };
	const originalLeaf = app.workspace.activeLeaf;
	const file = await app.vault.create(`bbe-callout-caret-${Date.now()}.md`, "");
	const leaf = app.workspace.getLeaf("tab");
	const passed = [];
	let clicked;
	try {
		require("electron").remote.getCurrentWindow().focus();
		await leaf.openFile(file, { state: { mode: "source", source: false } });
		await pause(250);
		const cm = leaf.view.editor.cm;
		const root = () => cm.dom.querySelector(".bbe-inline-editor");
		const embedded = part => cm.constructor.findFromDOM(root().querySelector(part === "title" ?
			".bbe-title-host .cm-editor" : ".bbe-editor-host > .markdown-source-view > .cm-editor"));
		const load = async block => {
			root()?.querySelector(":scope > .bbe-close").click();
			await pause();
			const text = `before\n\n${block}\n\nafter`;
			cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: text }, selection: { anchor: 0 } });
			cm.focus(); await pause(250);
			return text;
		};
		const pointAt = (element, needle, offset) => {
			const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
			for (let node; (node = walker.nextNode());) {
				const from = node.textContent.indexOf(needle);
				if (from < 0) continue;
				const range = document.createRange();
				range.setStart(node, from + offset); range.collapse(true);
				const rect = range.getBoundingClientRect();
				assert(rect.height > 0, "clicked text is not visible");
				return { clientX: rect.left + 0.1, clientY: (rect.top + rect.bottom) / 2 };
			}
			throw new Error(`text missing: ${needle}`);
		};
		const click = (target, point, pointerType = "mouse") => {
			clicked = { point, block: target.closest(".cm-callout, .bbe-inline-editor").getBoundingClientRect().toJSON(),
				target: target.getBoundingClientRect().toJSON(), font: getComputedStyle(target).font };
			const options = { bubbles: true, cancelable: true, button: 0, buttons: 1, detail: 1,
				pointerId: 1, isPrimary: true, pointerType, ...point };
			target.dispatchEvent(new PointerEvent("pointerdown", options));
			if (pointerType === "mouse") target.dispatchEvent(new MouseEvent("mousedown", options));
			(target.isConnected ? target : cm.contentDOM).dispatchEvent(new PointerEvent("pointerup", { ...options, buttons: 0 }));
			if (pointerType === "mouse") (target.isConnected ? target : cm.contentDOM).dispatchEvent(new MouseEvent("mouseup", { ...options, buttons: 0 }));
			(target.isConnected ? target : cm.contentDOM).dispatchEvent(new MouseEvent("click", { ...options, buttons: 0 }));
		};
		const check = (part, expected, text) => {
			assert(root(), "callout editor did not open");
			const view = embedded(part);
			assert(view.hasFocus && view.state.selection.main.empty && view.state.selection.main.head === expected,
				`wrong ${part} caret: ` + JSON.stringify({ expected, actual: view.state.selection.toJSON(), doc: view.state.doc.toString(),
					focus: view.hasFocus, active: document.activeElement?.outerHTML.slice(0, 300), windowFocus: document.hasFocus(),
					clicked, root: root().getBoundingClientRect().toJSON(), expectedCoords: view.coordsAtPos(expected),
					font: getComputedStyle(view.contentDOM).font }));
			assert(cm.state.doc.toString() === text, "click changed the source");
			const sourceOffset = text.indexOf(view.state.doc.toString()) + expected;
			if (part === "title") assert(cm.state.selection.main.head === sourceOffset, "title caret was not mirrored to the note");
		};

		for (const pointerType of ["mouse", "touch", "pen"]) {
			for (const part of ["body", "title"]) {
				const text = await load("> [!note] 日本語のタイトルです\n> 最初の行です\n> 二番目の文章です");
				const target = cm.dom.querySelector(`.cm-callout ${part === "title" ? ".callout-title-inner" : ".callout-content p"}`);
				const needle = part === "title" ? "日本語のタイトルです" : "二番目の文章です";
				const point = pointAt(target, needle, 4);
				click(target, point, pointerType); await pause(350);
				check(part, part === "title" ? 4 : "最初の行です\n".length + 4, text);
			}
		}
		passed.push("mouse, touch and pen place the caret at the clicked Japanese title/body character, including the second line");

		for (const part of ["body", "title"]) {
			const text = await load("> [!note] 日本語のタイトルです\n> 本文の文章です");
			const target = cm.dom.querySelector(`.cm-callout ${part === "title" ? ".callout-title-inner" : ".callout-content p"}`);
			const needle = part === "title" ? "日本語のタイトルです" : "本文の文章です";
			const options = { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true,
				pointerType: "touch", ...pointAt(target, needle, 3) };
			target.dispatchEvent(new PointerEvent("pointerdown", options));
			cm.dispatch({ selection: { anchor: text.indexOf("> [!note]") } });
			await pause(100);
			assert(!target.isConnected, "native selection did not replace the rendered callout");
			cm.contentDOM.dispatchEvent(new PointerEvent("pointerup", options));
			await pause(100);
			cm.contentDOM.dispatchEvent(new MouseEvent("click", options));
			await pause(250);
			check(part, 3, text);
		}
		passed.push("pointerdown coordinates survive native DOM replacement and a delayed click");

		{
			const sentence = "折り返される長い本文をクリックします。";
			const long = sentence.repeat(12) + "末尾の目印です";
			const text = await load(`> [!note] Title\n> ${long}`);
			const target = cm.dom.querySelector(".cm-callout .callout-content p");
			click(target, pointAt(target, "末尾の目印です", 3)); await pause(350);
			check("body", sentence.length * 12 + 3, text);
		}
		passed.push("a click on a wrapped visual row retains its character position");

		{
			const text = await load("> [!note] 日本語のタイトルです\n> 本文です");
			cm.dom.querySelector(".cm-callout .callout-content p").click(); await pause(250);
			const target = root().querySelector(".callout-title > .callout-title-inner:not(.bbe-title-host)");
			click(target, pointAt(target, "日本語のタイトルです", 3)); await pause(350);
			check("title", 3, text);
		}
		passed.push("clicking the title preview of an already open callout also restores the clicked character");

		for (const part of ["body", "title"]) {
			const text = await load("> [!note] First\n> original\n\nseparator\n\n> [!tip] 日本語のタイトルです\n> 切替先の文章です");
			cm.dispatch({ selection: { anchor: text.indexOf("original") + 2 } }); await pause(250);
			const previous = root();
			const target = cm.dom.querySelector(`.cm-callout .callout[data-callout=tip] ${part === "title" ? ".callout-title-inner" : ".callout-content p"}`);
			const needle = part === "title" ? "日本語のタイトルです" : "切替先の文章です";
			embedded("body").dispatch({ changes: { from: 0, insert: "pending\n" } });
			const point = pointAt(target, needle, 4);
			click(target, point); await pause(350);
			assert(root() !== previous && !previous.isConnected, "click did not switch callouts");
			check(part, 4, text.replace("> original", "> pending\n> original"));
		}
		passed.push("switching callouts restores the click after flushing edits that move the destination");
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
