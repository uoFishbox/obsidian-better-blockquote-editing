// Run through Obsidian CLI eval. Only this temporary note is changed.
(async () => {
	const pause = (ms = 150) => new Promise(resolve => setTimeout(resolve, ms));
	const assert = (ok, message) => { if (!ok) throw new Error(message); };
	const originalLeaf = app.workspace.activeLeaf;
	const file = await app.vault.create(`bbe-callout-selection-${Date.now()}.md`, "");
	const leaf = app.workspace.getLeaf("tab");
	const passed = [];
	try {
		require("electron").remote.getCurrentWindow().focus();
		await leaf.openFile(file, { state: { mode: "source", source: false } });
		await pause(250);
		const cm = leaf.view.editor.cm;
		const root = () => cm.dom.querySelector(".bbe-inline-editor");
		const load = async block => {
			if (root()) { root().querySelector(":scope > .bbe-close").click(); await pause(); }
			const text = `before\n\n${block}\n\nafter`;
			cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: text }, selection: { anchor: 0 } });
			cm.focus();
			await pause();
			return { text, from: text.indexOf(block), to: text.indexOf(block) + block.length };
		};
		for (const block of ["> [!note] Title\n> body\n>\n> last", "> [!tip]- Title\n> body",
			"  > [!note]\n  > body", "> [!note] Title", "> [!note]\n>"]) {
			const { text, from, to } = await load(block);
			cm.dispatch({ selection: { anchor: to, head: from }, userEvent: "select.pointer" });
			await pause(300);
			assert(root(), `whole-callout selection did not open: ${block}`);
			const body = cm.constructor.findFromDOM(root().querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"));
			assert(body.hasFocus && body.state.selection.main.empty && body.state.selection.main.head === 0,
				"whole-callout selection did not focus the body start");
			assert(cm.state.doc.toString() === text && cm.state.selection.main.empty, "opening changed the source or retained the whole-block selection");
		}
		passed.push("whole-callout selections with the caret at the start open the body, including folded, indented and empty callouts");

		{
			const { text } = await load("> [!note] Title\n> body\n> last");
			const content = cm.dom.querySelector(".cm-callout .callout-content p");
			assert(content, "native callout body missing");
			const bounds = content.getBoundingClientRect();
			for (const type of ["mousedown", "mouseup", "click"]) {
				content.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true,
					button: 0, buttons: type === "mousedown" ? 1 : 0,
					clientX: bounds.left + 10, clientY: bounds.top + bounds.height / 2 }));
			}
			await pause(300);
			assert(root(), "clicking the native callout body did not open the editor: " + JSON.stringify(cm.state.selection.toJSON()));
			const body = cm.constructor.findFromDOM(root().querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"));
			assert(body.hasFocus && body.state.selection.main.head === 0 && cm.state.doc.toString() === text,
				"native body click lost focus, cursor position or source text");
		}
		passed.push("native callout body mouse events open the editor at the body start");

		// Native mobile taps can leave an empty caret on the header before click.
		// Desktop mouse input instead selects the whole block backward. Both must
		// use the actual target, even when selection updates arrive in another task.
		for (const pointerType of ["mouse", "touch", "pen"]) {
			for (const part of ["body", "title", "button"]) {
				const { text, from, to } = await load("> [!note] **Title**\n> body\n> last");
				const selector = part === "body" ? ".callout-content p" :
					part === "title" ? ".callout-title-inner strong" : ".edit-block-button";
				const target = cm.dom.querySelector(".cm-callout " + selector);
				assert(target, `${pointerType} ${part} target missing`);
				const options = { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true, pointerType };
				target.dispatchEvent(new PointerEvent("pointerdown", options));
				cm.dispatch({ selection: pointerType === "mouse" ? { anchor: to, head: from } : { anchor: from } });
				await pause(30);
				(target.isConnected ? target : cm.contentDOM).dispatchEvent(new PointerEvent("pointerup", options));
				// Include a delayed click, after pointerup cleanup and native selection.
				await pause(30);
				(target.isConnected ? target : cm.contentDOM).dispatchEvent(new MouseEvent("click", options));
				await pause(300);
				assert(root(), `${pointerType} ${part} did not open`);
				const title = cm.constructor.findFromDOM(root().querySelector(".bbe-title-host .cm-editor"));
				const body = cm.constructor.findFromDOM(root().querySelector(".bbe-editor-host > .markdown-source-view > .cm-editor"));
				assert(part === "title" ? title.hasFocus && title.state.selection.main.head === title.state.doc.length :
					body.hasFocus && body.state.selection.main.head === 0, `${pointerType} ${part} focused the wrong editor`);
				assert(cm.state.doc.toString() === text, `${pointerType} ${part} changed the source`);
			}
		}
		passed.push("mouse, touch and pen targets override native whole-block/header selections for title, body and edit button");

		for (const part of ["body", "title"]) {
			await load("> [!note] Title\n> body");
			cm.dom.querySelector(".cm-callout " + (part === "body" ? ".callout-content p" : ".callout-title-inner")).click();
			await pause(300);
			assert(root(), `direct ${part} click without a selection change did not open`);
			const focused = cm.constructor.findFromDOM(root().querySelector(part === "body" ?
				".bbe-editor-host > .markdown-source-view > .cm-editor" : ".bbe-title-host .cm-editor"));
			assert(focused.hasFocus, `direct ${part} click focused the wrong editor`);
		}
		passed.push("direct body/title clicks work without any preceding native selection change");

		for (const selector of ["a", "input[type=checkbox]", ".callout-fold"]) {
			await load("> [!note]+ [Title](https://example.com)\n> - [ ] task");
			const control = cm.dom.querySelector(".cm-callout " + selector);
			assert(control, `native ${selector} missing`);
			// Stop before the native action (navigation, toggling, folding), but observe
			// whether our capture handler consumed it or opened an editor.
			let prevented = null;
			control.addEventListener("click", event => {
				prevented = event.defaultPrevented;
				event.preventDefault(); event.stopImmediatePropagation();
			}, { capture: true, once: true });
			control.click();
			await pause();
			assert(prevented === false && !root(), `native ${selector} click was intercepted`);
		}
		passed.push("links, task checkboxes and fold controls retain their native click handling");

		{
			const { from } = await load("> [!note] Title\n> body\n> last");
			const target = cm.dom.querySelector(".cm-callout .callout-content p");
			const options = { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true, pointerType: "touch" };
			target.dispatchEvent(new PointerEvent("pointerdown", options));
			target.dispatchEvent(new PointerEvent("pointercancel", options));
			await pause();
			assert(!root(), "cancelled touch opened the editor");
			cm.dispatch({ selection: { anchor: from } });
			await pause(300);
			assert(root()?.querySelector(".bbe-editing-title"), "keyboard entry after cancelled touch did not focus the title");
		}
		passed.push("cancelled touch clears the target so subsequent caret entry still opens the title");

		{
			const { from, to } = await load("> [!note] Title\n> body\n> last");
			for (const selection of [
				{ anchor: from, head: to },
				{ anchor: to - 1, head: from },
				{ anchor: to, head: from + 1 },
				{ anchor: to + 1, head: from },
				{ anchor: to, head: from - 1 },
			]) {
				cm.dispatch({ selection });
				await pause();
				assert(!root(), "an ordinary range selection opened an editor: " + JSON.stringify(selection));
			}
			const Selection = cm.state.selection.constructor;
			cm.dispatch({ selection: Selection.create([Selection.cursor(0), Selection.range(to, from)]) });
			await pause();
			assert(!root(), "multiple selections opened an editor");
			cm.dispatch({ selection: { anchor: 0 } });
			cm.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
			cm.dispatch({ selection: { anchor: to, head: from } });
			await pause();
			assert(!root(), "whole-callout selection interrupted composition");
			cm.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
			await pause(300);
			assert(root(), "whole-callout selection did not open after composition ended");
		}
		const plain = await load("> body\n> last");
		cm.dispatch({ selection: { anchor: plain.to, head: plain.from } });
		await pause();
		assert(!root(), "whole plain-quote selection opened an editor");
		passed.push("ordinary ranges, plain quotes, multiple selections and IME keep their existing behavior");
		return JSON.stringify({ passed });
	} finally {
		if (typeof leaf.view.save === "function") await leaf.view.save();
		leaf.detach(); await pause(300);
		if (app.vault.getAbstractFileByPath(file.path) === file) await app.vault.delete(file);
		if (originalLeaf) app.workspace.setActiveLeaf(originalLeaf, { focus: true });
	}
})()
