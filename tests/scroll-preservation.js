// Run through Obsidian CLI eval. Only this temporary note is changed.
(async () => {
	const pause = (ms = 150) => new Promise(resolve => setTimeout(resolve, ms));
	const assert = (ok, message) => { if (!ok) throw new Error(message); };
	const originalLeaf = app.workspace.activeLeaf;
	const file = await app.vault.create(`bbe-scroll-${Date.now()}.md`, "");
	const leaf = app.workspace.getLeaf("tab");
	const passed = [];
	try {
		require("electron").remote.getCurrentWindow().focus();
		await leaf.openFile(file, { state: { mode: "source", source: false } });
		await pause(250);
		const cm = leaf.view.editor.cm;
		const root = () => cm.dom.querySelector(".bbe-inline-editor");
		const bodyView = (host = cm) => cm.constructor.findFromDOM(host.dom.querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"));
		const load = async block => {
			root()?.querySelector(":scope > .bbe-close").click();
			await pause();
			const text = `${"before\n\n".repeat(70)}${block}\n\n${"after\n\n".repeat(100)}`;
			cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: text }, selection: { anchor: 0 } });
			cm.focus();
			await pause(250);
			// Reveal the block without moving the caret into it and opening the editor.
			cm.dispatch({ effects: cm.constructor.scrollIntoView(text.indexOf(">"), { y: "start", yMargin: 120 }) });
			await pause(250);
			return text;
		};
		const checkOpen = async (label, open, host = cm) => {
			assert(!host.dom.querySelector(".bbe-inline-editor"), `${label}: fixture already has an editor`);
			const source = cm.state.doc.toString();
			const before = { top: cm.scrollDOM.scrollTop, left: cm.scrollDOM.scrollLeft };
			const positions = [];
			const record = () => positions.push(cm.scrollDOM.scrollTop);
			cm.scrollDOM.addEventListener("scroll", record);
			try {
				open();
				await pause(500);
				assert(host.dom.querySelector(".bbe-inline-editor") && bodyView(host), `${label}: editor did not open: ${JSON.stringify({
					before, after: cm.scrollDOM.scrollTop, selection: host.state.selection.toJSON(), focus: host.hasFocus,
					html: host.contentDOM.innerHTML.slice(-400),
				})}`);
				record();
				assert(positions.every(top => Math.abs(top - before.top) <= 2) && Math.abs(cm.scrollDOM.scrollLeft - before.left) <= 2,
					`${label}: opening moved the main editor: ${JSON.stringify({ before, positions, after: cm.scrollDOM.scrollTop })}`);
			} finally {
				cm.scrollDOM.removeEventListener("scroll", record);
			}
			assert(cm.state.doc.toString() === source, `${label}: opening changed the source`);
			passed.push(label);
		};
		const textPoint = (target, needle) => {
			const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
			for (let node; (node = walker.nextNode());) {
				const at = node.textContent.indexOf(needle);
				if (at < 0) continue;
				const range = document.createRange();
				range.setStart(node, at + 2);
				range.collapse(true);
				const rect = range.getBoundingClientRect();
				return { clientX: rect.left + 0.1, clientY: (rect.top + rect.bottom) / 2 };
			}
			throw new Error(`text missing: ${needle}`);
		};
		const click = (target, point) => {
			const options = { bubbles: true, cancelable: true, button: 0, buttons: 1, detail: 1,
				pointerId: 1, isPrimary: true, pointerType: "mouse", ...point };
			target.dispatchEvent(new PointerEvent("pointerdown", options));
			target.dispatchEvent(new MouseEvent("mousedown", options));
			(target.isConnected ? target : cm.contentDOM).dispatchEvent(new PointerEvent("pointerup", { ...options, buttons: 0 }));
			(target.isConnected ? target : cm.contentDOM).dispatchEvent(new MouseEvent("mouseup", { ...options, buttons: 0 }));
			(target.isConnected ? target : cm.contentDOM).dispatchEvent(new MouseEvent("click", { ...options, buttons: 0 }));
		};

		for (const part of ["body", "title"]) {
			await load("> [!note] Title\n> body");
			await checkOpen(`clicking a callout ${part} preserves main scroll`, () =>
				cm.dom.querySelector(`.cm-callout ${part === "title" ? ".callout-title-inner" : ".callout-content p"}`).click());
		}

		for (const callout of [true, false]) {
			const block = `${callout ? "> [!note] Title\n" : ""}${Array.from({ length: 90 }, (_, i) => `> body ${i}`).join("\n")}`;
			const text = await load(block);
			const at = text.indexOf("body 40");
			if (callout) {
				const target = cm.dom.querySelector(".cm-callout .callout-content p");
				cm.scrollDOM.scrollTop += textPoint(target, "body 40").clientY - cm.scrollDOM.getBoundingClientRect().top - 180;
			} else cm.dispatch({ effects: cm.constructor.scrollIntoView(at, { y: "center" }) });
			await pause(250);
			await checkOpen(`entering a long ${callout ? "callout" : "blockquote"} preserves main scroll`, () =>
				cm.dispatch({ selection: { anchor: at } }));
			const embedded = bodyView();
			assert(embedded.hasFocus && embedded.state.selection.main.head === embedded.state.doc.toString().indexOf("body 40"),
				"opening lost the body caret or focus");
			const top = cm.scrollDOM.scrollTop;
			cm.scrollDOM.scrollTop = top + 80;
			await pause(250);
			assert(Math.abs(cm.scrollDOM.scrollTop - top - 80) <= 2, "scroll was locked after opening");
			embedded.dispatch({ selection: { anchor: embedded.state.doc.length }, scrollIntoView: true });
			await pause(250);
			assert(cm.scrollDOM.scrollTop > top + 100, "normal caret navigation no longer scrolls after opening: " + JSON.stringify({
				top, after: cm.scrollDOM.scrollTop, focus: embedded.hasFocus,
				end: embedded.coordsAtPos(embedded.state.doc.length), scroller: cm.scrollDOM.getBoundingClientRect().toJSON(),
			}));
		}

		await load(`> [!note] Title\n${Array.from({ length: 90 }, (_, i) => `> body ${i}`).join("\n")}`);
		let target = cm.dom.querySelector(".cm-callout .callout-content p");
		cm.scrollDOM.scrollTop += textPoint(target, "body 40").clientY - cm.scrollDOM.getBoundingClientRect().top - 180;
		await pause(250);
		await checkOpen("clicking a visible character in a long callout preserves scroll and caret", () =>
			click(target, textPoint(target, "body 40")));
		assert(bodyView().state.selection.main.head === bodyView().state.doc.toString().indexOf("body 40") + 2,
			"long callout click lost its character position: " + JSON.stringify({
				actual: bodyView().state.selection.toJSON(), expected: bodyView().state.doc.toString().indexOf("body 40") + 2,
			}));

		await load("> [!note] Outer\n> start\n>\n> > [!tip] Inner\n> > nested body\n>\n> end");
		await checkOpen("opening an outer callout preserves main scroll", () =>
			cm.dom.querySelector(".cm-callout .callout-content p").click());
		const outer = bodyView();
		target = outer.dom.querySelector(".cm-callout .callout-content p");
		await checkOpen("opening a nested callout preserves main scroll", () =>
			click(target, textPoint(target, "nested body")), outer);

		await load("> [!note] Title\n> body");
		cm.dom.querySelector(".cm-callout .callout-content p").click();
		cm.scrollDOM.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 80 }));
		cm.scrollDOM.scrollTop += 80;
		const userScroll = cm.scrollDOM.scrollTop;
		await pause(500);
		assert(root() && Math.abs(cm.scrollDOM.scrollTop - userScroll) <= 2, "opening overrode a user scroll during mounting");
		passed.push("user scrolling during mounting cancels scroll restoration");
		return JSON.stringify({ passed });
	} catch (error) {
		throw new Error(`${error.stack}\nCompleted: ${JSON.stringify(passed)}`);
	} finally {
		if (typeof leaf.view.save === "function") await leaf.view.save();
		leaf.detach();
		await pause(300);
		if (app.vault.getAbstractFileByPath(file.path) === file) await app.vault.delete(file);
		if (originalLeaf) app.workspace.setActiveLeaf(originalLeaf, { focus: true });
	}
})()
