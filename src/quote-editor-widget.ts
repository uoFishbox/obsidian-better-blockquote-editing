import { ChangeSet, EditorSelection, EditorState, Transaction, type Extension } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { EditorView, WidgetType } from "@codemirror/view";
import type { EmbeddableMarkdownEditorComponent } from "@mnaoumov/obsidian-lib/components/embeddable-markdown-editor-component";
import { App, Component, editorInfoField, editorLivePreviewField, MarkdownRenderer, Modal, Notice, setIcon, type TFile } from "obsidian";
import { bodyOffsetToSource, calloutTitle, findQuote, serializeQuote, sourceOffsetToBody, titleOffsetToSource, withCalloutTitle, type QuoteBlock } from "./quote";
import { mergePendingText, textChanges } from "./sync";
import { editingField, mirroredUpdate, sourceUpdate, stopEditing, syncConflict, syncEditing, type ExitDirection } from "./editing-state";
import { NativeQuoteEditor } from "./native-editor";
import { CalloutTypeModal, changeCalloutType } from "./callout-type-modal";

/** Keep the same native editor and its history while mirroring text into the note. */
export class QuoteEditorWidget extends WidgetType {
	private body: string;
	private lastSource: string;
	private syncScheduled = false;
	private receiveScheduled = false;
	private receiveSelection = false;
	private pendingChanges: ChangeSet;
	private syncedBody: string;
	private mounted = false;
	private shownHeader?: string | null;
	private disposed = false;
	private userEvent = "input.type";
	private mounts = new Map<HTMLElement, EmbeddableMarkdownEditorComponent>();
	private statuses = new Set<HTMLElement>();
	private conflicted = false;
	private root?: HTMLElement;
	private layout?: Promise<HTMLElement>;
	private renderer = new Component();
	private readonly sourceFile: TFile | null;
	private title: string;
	private syncedTitle: string;
	private pendingTitle: ChangeSet;
	private titleEditor?: NativeQuoteEditor;
	private titleHost?: HTMLElement;
	private typeModal?: CalloutTypeModal;

	private get titleView(): EditorView | undefined { return this.titleEditor?.editorView; }

	constructor(private app: App, public quote: QuoteBlock, private parent: EditorView, private readonly inlineExtension: Extension,
		private readonly selectTitleOnOpen = false) {
		super();
		this.body = quote.body;
		this.lastSource = quote.source;
		this.syncedBody = quote.body;
		this.pendingChanges = ChangeSet.empty(quote.body.length);
		this.title = this.syncedTitle = calloutTitle(quote.header).text;
		this.pendingTitle = ChangeSet.empty(this.title.length);
		this.sourceFile = parent.state.field(editorInfoField, false)?.file ?? null;
	}

	toDOM(): HTMLElement {
		if (this.root) {
			this.mountEditor(this.root);
			return this.root;
		}
		const root = this.parent.dom.ownerDocument.createElement("div");
		this.root = root;
		root.className = "bbe-inline-editor";
		root.contentEditable = "false";
		root.tabIndex = -1;
		root.setAttribute("role", "group");
		root.setAttribute("aria-label", this.quote.header ? "Calloutを編集" : "引用を編集");
		this.mountEditor(root);
		return root;
	}

	private async renderShell(container: HTMLElement, renderer: Component, header: string | null): Promise<{ shell: HTMLElement; body: HTMLElement }> {
		if (header) {
			renderer.load();
			// Keep the saved fold marker, but always expose the body while editing.
			await MarkdownRenderer.render(this.app, `> ${header.replace(/^(\[![^\]]+\])[+-]/, "$1")}`,
				container, this.sourceFile?.path ?? "", renderer);
			const callout = container.querySelector<HTMLElement>(".callout");
			if (!callout) throw new Error("Native callout rendering produced no callout");
			callout.addClass("bbe-callout");
			// Obsidian omits the content element for a header-only callout.
			return { shell: callout, body: callout.querySelector<HTMLElement>(".callout-content") ?? callout.createDiv({ cls: "callout-content" }) };
		}
		// Reuse Live Preview's quote styling, including its rail and theme typography.
		const shell = container.createEl("blockquote", { cls: "bbe-blockquote HyperMD-quote" });
		return { shell, body: shell };
	}

	private async createLayout(root: HTMLElement): Promise<HTMLElement> {
		const originalHeader = this.quote.header;
		const { body } = await this.renderShell(root, this.renderer, originalHeader);
		if (this.disposed) {
			this.renderer.unload();
			return root;
		}
		const host = body.createDiv({ cls: "bbe-editor-host" });
		const close = root.createEl("button", { cls: "bbe-close clickable-icon" });
		close.setAttribute("type", "button");
		close.setAttribute("aria-label", "閉じる");
		close.setAttribute("title", "編集を閉じる (Esc / Ctrl/Cmd+Enter)");
		setIcon(close, "x");
		const status = body.createDiv({ cls: "bbe-status" });
		status.setAttribute("role", "status");
		this.statuses.add(status);
		this.showConflict(this.conflicted);
		close.addEventListener("click", () => this.finish());
		this.shownHeader = originalHeader;
		this.mountTitle(root);
		return host;
	}

	private mountTitle(root: HTMLElement): void {
		const row = root.querySelector<HTMLElement>(":scope > .bbe-callout > .callout-title");
		const preview = row?.querySelector<HTMLElement>(".callout-title-inner");
		if (!row || !preview) {
			this.titleEditor?.unload();
			this.titleEditor = undefined;
			this.titleHost = undefined;
			return;
		}
		const icon = row.querySelector<HTMLElement>(".callout-icon");
		if (icon) {
			icon.setAttribute("role", "button");
			icon.tabIndex = 0;
			icon.setAttribute("aria-label", "Calloutのタイプを変更");
			icon.setAttribute("title", "Calloutのタイプを変更");
			icon.addEventListener("pointerdown", event => { event.preventDefault(); event.stopPropagation(); });
			icon.addEventListener("click", event => {
				event.preventDefault();
				event.stopPropagation();
				this.openTypeModal();
			});
			icon.addEventListener("keydown", event => {
				if (event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault();
				event.stopPropagation();
				this.openTypeModal();
			});
		}
		preview.addEventListener("click", event => {
			event.preventDefault();
			event.stopPropagation();
			this.focusTitle(this.title.length);
		});
		if (!this.titleHost) {
			this.titleHost = root.ownerDocument.createElement("div");
			this.titleHost.className = "callout-title-inner bbe-title-host";
			row.append(this.titleHost);
			let loaded = false;
			const component = new NativeQuoteEditor({
				app: this.app, containerEl: this.titleHost, value: this.title,
				placeholder: preview.textContent ?? "タイトル",
				onEnter: ({ isModifierPressed, component }) => {
					if (component.editorView.compositionStarted) return false;
					if (isModifierPressed) this.finish();
					else this.focusBody(0);
					return true;
				},
				onEscape: component => { if (!component.editorView.compositionStarted) this.finish(); },
			}, (direction, vertical) => {
				if (direction < 0) this.finish(-1, true);
				else this.focusBody(vertical ? Math.min(this.titleView!.state.selection.main.head, this.body.split("\n", 1)[0]!.length) : 0);
			}, this.sourceFile, () => this.scheduleSync(), [
				// A title is one Markdown line, including pasted text.
				EditorState.transactionFilter.of(tr => tr.newDoc.lines > 1 ? [] : tr),
				EditorView.updateListener.of(update => {
					// Native initialization sets the value before mounting is complete.
					if (!loaded) return;
					this.title = update.state.doc.toString();
					if (update.transactions.length && update.transactions.every(tr => tr.annotation(sourceUpdate))) return;
					if (update.docChanged) {
						this.pendingTitle = this.pendingTitle.compose(update.changes);
						this.userEvent = update.transactions.map(tr => tr.annotation(Transaction.userEvent)).find(Boolean) ?? "input.better-blockquote";
					}
					if (update.docChanged || update.selectionSet || update.focusChanged) this.scheduleSync();
					if (update.focusChanged && !update.view.hasFocus) {
						queueMicrotask(() => {
							if (this.disposed || this.titleView?.hasFocus) return;
							this.titleHost?.parentElement?.removeClass("bbe-editing-title");
							this.parent.requestMeasure();
							void this.refreshShell();
						});
					}
				}),
				EditorView.domEventHandlers({ compositionend: () => { this.scheduleReceive(); this.scheduleSync(); } }),
			]);
			try {
				component.load();
			} catch (error) {
				component.unload();
				throw error;
			}
			this.titleEditor = component;
			loaded = true;
			component.editorView.contentDOM.setAttribute("aria-label", "Calloutのタイトル");
		}
		row.append(this.titleHost);
		row.toggleClass("bbe-editing-title", !!this.titleView?.hasFocus);
	}

	private openTypeModal(): void {
		if (this.typeModal || this.isComposing() || !this.flush() || !this.quote.header) return;
		const type = /^\[!([^|\]]+)/.exec(this.quote.header)?.[1];
		if (!type) return;
		const titleFocused = !!this.titleView?.hasFocus;
		this.typeModal = new CalloutTypeModal(this.app, type, next => {
			// Re-read the source after the modal closes; the note may have changed meanwhile.
			if (this.isComposing() || !this.flush()) return;
			const current = this.parent.state.field(editingField, false);
			if (!current || current.widget !== this || !this.quote.header) return;
			changeCalloutType(this.parent, current.from, next);
		}, () => {
			this.typeModal = undefined;
			queueMicrotask(() => {
				if (this.disposed || !this.root?.isConnected) return;
				if (titleFocused && this.titleView) this.focusTitle();
				else for (const editor of this.mounts.values()) editor.focus();
			});
		});
		this.typeModal.open();
	}

	private focusTitle(offset?: number, selectAll = false): void {
		if (!this.titleView || this.isComposing()) return;
		this.titleHost?.parentElement?.addClass("bbe-editing-title");
		if (offset !== undefined) this.titleView.dispatch({ selection: {
			anchor: selectAll ? 0 : Math.min(this.title.length, Math.max(0, offset)),
			head: selectAll ? this.title.length : undefined,
		}, scrollIntoView: true });
		this.titleView.focus();
		this.scheduleSync();
		this.parent.requestMeasure();
	}

	private focusBody(offset: number): void {
		for (const editor of this.mounts.values()) {
			editor.editorView.dispatch({ selection: { anchor: Math.min(this.body.length, Math.max(0, offset)) }, scrollIntoView: true });
			editor.focus();
		}
		this.scheduleSync();
	}

	private mountEditor(root: HTMLElement): void {
		// Mount after the parent update to avoid reentrant CodeMirror updates.
		queueMicrotask(async () => {
			if (this.disposed || this.mounts.has(root) || !root.isConnected ||
				this.parent.state.field(editingField, false)?.widget !== this) return;
			// A hidden source caret has no DOM position in a replacement widget.
			// Park focus here while rendering so CM does not move it to a block edge.
			if (this.parent.root.activeElement === this.parent.contentDOM) root.focus({ preventScroll: true });
			let host: HTMLElement;
			try {
				host = await (this.layout ??= this.createLayout(root));
			} catch (error) {
				if (this.disposed) return;
				console.error("Better Blockquote Editing: quote could not be rendered", error);
				new Notice("引用・calloutを表示できませんでした。コンソールを確認してください。");
				this.finish();
				return;
			}
			if (this.disposed || this.mounts.has(root) || !root.isConnected ||
				this.parent.state.field(editingField, false)?.widget !== this) return;
			const component = new NativeQuoteEditor({
				app: this.app, containerEl: host, value: this.body,
				cursorLocation: { anchor: this.quote.cursor, head: this.quote.cursor },
				placeholder: "Markdownを入力…",
				onChange: (update, editor) => {
					this.body = editor.value;
					if (!this.mounted || update.transactions.every(transaction => transaction.annotation(sourceUpdate))) return;
					this.pendingChanges = this.pendingChanges.compose(update.changes);
					const event = update.transactions.map((transaction) => transaction.annotation(Transaction.userEvent))
						.find((value) => value !== undefined);
					this.userEvent = event && /^(input|delete)(\.|$)/.test(event) ? event : "input.better-blockquote";
					this.scheduleSync();
				},
				onEnter: ({ isModifierPressed, component: editor }) => {
					if (!isModifierPressed || editor.editorView.compositionStarted) return false;
					this.finish();
					return true;
				},
				onEscape: (editor) => { if (!editor.editorView.compositionStarted) this.finish(); },
			}, (direction, vertical) => {
				if (direction < 0 && this.titleView) {
					const at = component.editorView.state.selection.main.head;
					this.focusTitle(vertical ? at : this.title.length);
				} else this.finish(direction, true);
			}, this.sourceFile, () => this.scheduleSync(), this.inlineExtension);
			this.mounts.set(root, component);
			try {
				component.load();
				this.mounted = true;
				if (this.shownHeader !== this.quote.header) void this.refreshShell();
				component.editorView.contentDOM.setAttribute("aria-label", "引用・calloutの本文");
				if (this.quote.titleCursor !== null && this.titleView) this.focusTitle(this.quote.titleCursor, this.selectTitleOnOpen);
				else component.focus();
				if (this.receiveSelection) this.scheduleReceive(true);
				this.scheduleSync();
				this.parent.requestMeasure();
			} catch (error) {
				this.mounts.delete(root);
				component.unload();
				console.error("Better Blockquote Editing: native editor could not be mounted", error);
				new Notice("Obsidian標準エディタを開けませんでした。コンソールを確認してください。");
				this.finish();
			}
		});
	}

	showConflict(conflict: boolean): void {
		this.conflicted = conflict;
		for (const status of this.statuses) {
			status.toggleClass("bbe-conflict", conflict);
			status.hidden = !conflict;
			status.setText(conflict
				? "未反映の入力と元ノートの変更が競合したか、引用の削除・読み取り専用化により同期を保留しています。未反映のタイトル・本文をコピーしてから閉じてください。"
				: "");
		}
	}

	private scheduleSync(): void {
		if (this.syncScheduled || this.disposed) return;
		this.syncScheduled = true;
		// The embedded CM must finish its update before its parent is dispatched.
		queueMicrotask(() => {
			this.syncScheduled = false;
			if (!this.disposed) this.sync();
		});
	}

	private sync(): boolean {
		let current = this.parent.state.field(editingField, false);
		if (this.disposed || current?.widget !== this) return false;
		if (current.conflict) return false;
		if (!current.valid || this.parent.state.sliceDoc(current.from, current.to) !== this.lastSource) {
			if (!this.receiveSource()) return false;
			current = this.parent.state.field(editingField, false);
			if (this.disposed || current?.widget !== this || current.conflict) return false;
		}
		if (this.parent.state.readOnly) {
			this.parent.dispatch({ effects: syncConflict.of(this) });
			return false;
		}
		const next = serializeQuote(this.quote, this.body, this.title);
		const selection = this.sourceSelection(current.from, next);
		if (next === this.lastSource) {
			this.syncedBody = this.body;
			this.pendingChanges = ChangeSet.empty(this.body.length);
			this.syncedTitle = this.title;
			this.pendingTitle = ChangeSet.empty(this.title.length);
			if (selection && !selection.eq(this.parent.state.selection)) {
				this.parent.dispatch({ selection, annotations: [Transaction.addToHistory.of(false), mirroredUpdate.of(true)] });
			}
			return true;
		}
		// A minimal change keeps normal typing history and avoids replacing whole blocks.
		const changes: { from: number; to: number; insert: string }[] = [];
		textChanges(this.lastSource, next).iterChanges((from, to, _a, _b, insert) =>
			changes.push({ from: current!.from + from, to: current!.from + to, insert: insert.toString() }));
		this.parent.dispatch({
			changes,
			selection,
			effects: syncEditing.of({ widget: this, length: next.length }),
			annotations: [Transaction.userEvent.of(this.userEvent), mirroredUpdate.of(true)],
		});
		this.lastSource = next;
		this.syncedBody = this.body;
		this.pendingChanges = ChangeSet.empty(this.body.length);
		this.syncedTitle = this.title;
		this.pendingTitle = ChangeSet.empty(this.title.length);
		return true;
	}

	scheduleReceive(selection = false): void {
		this.receiveSelection ||= selection;
		if (this.receiveScheduled || this.disposed) return;
		this.receiveScheduled = true;
		queueMicrotask(() => {
			this.receiveScheduled = false;
			if (!this.disposed) this.receiveSource();
		});
	}

	private isComposing(): boolean {
		return !!this.titleView?.compositionStarted || [...this.mounts.values()].some(editor => editor.editorView.compositionStarted ||
			editor.editorView.state.field(editingField, false)?.widget.isComposing());
	}

	private hasPendingChanges(): boolean {
		return !this.pendingTitle.empty || !this.pendingChanges.empty || [...this.mounts.values()].some(editor =>
			editor.editorView.state.field(editingField, false)?.widget.hasPendingChanges());
	}

	private receiveSource(): boolean {
		const current = this.parent.state.field(editingField, false);
		if (this.disposed || current?.widget !== this || current.conflict || this.isComposing()) return false;
		if (!current.valid) {
			if (this.hasPendingChanges()) this.parent.dispatch({ effects: syncConflict.of(this) });
			else {
				const focused = !!this.titleView?.hasFocus || [...this.mounts.values()].some(editor => editor.editorView.dom.contains(this.parent.root.activeElement));
				this.parent.dispatch({ effects: stopEditing.of(this), annotations: Transaction.addToHistory.of(false) });
				if (focused) this.parent.focus();
			}
			return false;
		}
		const source = this.parent.state.sliceDoc(current.from, current.to);
		const changed = source !== this.lastSource;
		// Markdown's syntax node starts at >, after any indentation on the first line.
		const quote = changed ? findQuote(this.parent.state.doc.toString(), current.from + Math.max(0, source.indexOf(">")), true) : this.quote;
		if (!quote) return false;
		const remoteTitle = changed ? calloutTitle(quote.header).text : this.syncedTitle;
		const bodyMerge = mergePendingText(this.syncedBody, this.body, this.pendingChanges, changed ? quote.body : this.syncedBody);
		const titleMerge = mergePendingText(this.syncedTitle, this.title, this.pendingTitle, remoteTitle);
		if (!bodyMerge || !titleMerge || changed && !quote.header && !this.pendingTitle.empty) {
			this.parent.dispatch({ effects: syncConflict.of(this) });
			return false;
		}
		const incoming = bodyMerge.incoming;
		const incomingTitle = titleMerge.incoming;
		if (changed) {
			this.pendingTitle = titleMerge.pending;
			this.title = titleMerge.value;
			this.syncedTitle = remoteTitle;
			this.pendingChanges = bodyMerge.pending;
			this.body = bodyMerge.value;
			this.syncedBody = quote.body;
			this.lastSource = source;
			const headerChanged = this.quote.header !== quote.header;
			this.quote = quote;
			if (headerChanged && this.mounted) void this.refreshShell();
		}
		const selectionRequested = this.receiveSelection;
		if (this.mounted) this.receiveSelection = false;
		const parentSelection = this.parent.state.selection;
		const inside = selectionRequested && parentSelection.ranges.every(range => range.from >= current.from && range.to <= current.to);
		const inTitle = !!quote.header && inside && parentSelection.ranges.every(range => range.to <= current.from + source.split("\n", 1)[0]!.length);
		if (this.titleView) {
			const map = (at: number) => this.pendingTitle.mapPos(Math.max(0, Math.min(remoteTitle.length,
				at - current.from - titleOffsetToSource(quote, source, 0))));
			const selection = inTitle ? EditorSelection.create(parentSelection.ranges.map(range =>
				EditorSelection.range(map(range.anchor), map(range.head))), parentSelection.mainIndex) : undefined;
			if (!incomingTitle.empty || selection && !selection.eq(this.titleView.state.selection)) {
				this.titleView.dispatch({ changes: incomingTitle, selection,
					annotations: [sourceUpdate.of(true), Transaction.addToHistory.of(false)] });
			}
			if (inTitle && this.parent.hasFocus) this.focusTitle();
		}
		for (const editor of this.mounts.values()) {
			if (!this.mounted) continue;
			let selection: EditorSelection | undefined;
			if (inside && !inTitle) {
				const map = (at: number) => this.pendingChanges.mapPos(sourceOffsetToBody(this.quote, source, at - current.from));
				selection = EditorSelection.create(parentSelection.ranges.map(range =>
					EditorSelection.range(map(range.anchor), map(range.head))), parentSelection.mainIndex);
			}
			if (!incoming.empty || selection && !selection.eq(editor.editorView.state.selection)) {
				editor.editorView.dispatch({ changes: incoming, selection,
					annotations: [sourceUpdate.of(true), Transaction.addToHistory.of(false)] });
			}
			if (inside && !inTitle && this.parent.hasFocus) editor.focus();
		}
		if (!this.pendingChanges.empty || !this.pendingTitle.empty || changed && !selectionRequested) this.scheduleSync();
		return true;
	}

	private async refreshShell(): Promise<void> {
		const root = this.root;
		if (!root) return;
		const header = this.quote.header ? withCalloutTitle(this.quote.header, this.title) : null;
		if (this.shownHeader === header) return;
		const renderer = new Component();
		const container = root.ownerDocument.createElement("div");
		try {
			const { shell, body } = await this.renderShell(container, renderer, header);
			if (this.disposed || (this.quote.header ? withCalloutTitle(this.quote.header, this.title) : null) !== header) { renderer.unload(); return; }
			if (header && this.shownHeader && withCalloutTitle(header, "").trimEnd() === withCalloutTitle(this.shownHeader, "").trimEnd()) {
				// Title-only changes must not detach either editor or interrupt focus/IME.
				const preview = root.querySelector<HTMLElement>(":scope > .bbe-callout > .callout-title > .callout-title-inner");
				const nextPreview = shell.querySelector(".callout-title-inner");
				if (preview && nextPreview) preview.replaceChildren(...Array.from(nextPreview.childNodes));
				this.renderer.unload();
				this.renderer = renderer;
				this.shownHeader = header;
				this.parent.requestMeasure();
				return;
			}
			const host = root.querySelector<HTMLElement>(".bbe-editor-host")!;
			const oldShell = host.parentElement!;
			const outerShell = oldShell.closest<HTMLElement>(".bbe-callout, .bbe-blockquote")!;
			const focused = root.ownerDocument.activeElement as HTMLElement | null;
			const restoreFocus = !!focused && host.contains(focused);
			const titleFocused = !!this.titleView?.hasFocus;
			body.append(host, ...this.statuses);
			outerShell.replaceWith(shell);
			this.renderer.unload();
			this.renderer = renderer;
			this.shownHeader = header;
			this.mountTitle(root);
			if (titleFocused) {
				if (this.titleView) this.focusTitle();
				else this.focusBody(0);
			} else if (restoreFocus) focused.focus({ preventScroll: true });
			this.parent.requestMeasure();
		} catch (error) {
			renderer.unload();
			console.error("Better Blockquote Editing: callout header could not be updated", error);
		}
	}

	private sourceSelection(from: number, source: string): EditorSelection | undefined {
		if (this.titleView?.hasFocus) {
			const selection = this.titleView.state.selection;
			const map = (at: number) => from + titleOffsetToSource(this.quote, source, at);
			return EditorSelection.create(selection.ranges.map(range =>
				EditorSelection.range(map(range.anchor), map(range.head))), selection.mainIndex);
		}
		for (const editor of this.mounts.values()) {
			const view = editor.editorView;
			// Do not overwrite a caret moved outside by the user or another plugin.
			// contains() includes focused editors nested inside this editor.
			if (!view.dom.contains(view.root.activeElement)) continue;
			const selection = view.state.selection;
			const map = (offset: number) => from + bodyOffsetToSource(this.quote, source, offset);
			return EditorSelection.create(selection.ranges.map(range =>
				EditorSelection.range(map(range.anchor), map(range.head))), selection.mainIndex);
		}
		return undefined;
	}

	private flush(): boolean {
		if (this.titleView?.compositionStarted) return false;
		for (const editor of this.mounts.values()) {
			if (editor.editorView.compositionStarted) return false;
			const inner = editor.editorView.state.field(editingField, false);
			if (inner && !inner.widget.flush()) return false;
		}
		return this.sync();
	}

	closeForSourceMode(): void {
		queueMicrotask(() => {
			if (this.disposed || this.parent.state.field(editingField, false)?.widget !== this ||
				this.parent.state.field(editorLivePreviewField, false) === true || this.isComposing()) return;
			const flushed = this.flush();
			if (this.disposed || this.parent.state.field(editingField, false)?.widget !== this) return;
			const drafts = flushed ? [] : this.pendingDrafts();
			const focused = !!this.titleView?.hasFocus || [...this.mounts.values()].some(editor => editor.editorView.dom.contains(this.parent.root.activeElement));
			this.parent.dispatch({ effects: stopEditing.of(this), annotations: Transaction.addToHistory.of(false) });
			if (drafts.length) {
				const modal = new Modal(this.app);
				modal.modalEl.addClass("bbe-draft-recovery");
				modal.titleEl.setText("未反映の編集");
				modal.contentEl.createEl("p", { text: "元ノートに反映できなかったタイトル・本文です。必要な内容をコピーしてから閉じてください。" });
				const text = modal.contentEl.createEl("textarea", { attr: { readonly: "", "aria-label": "未反映の編集内容" } });
				text.value = drafts.join("\n\n---\n\n");
				text.rows = 12;
				text.style.width = "100%";
				modal.open();
			} else if (focused) this.parent.focus();
		});
	}

	private pendingDrafts(): string[] {
		const drafts = this.pendingChanges.empty && this.pendingTitle.empty ? [] : [
			`${this.quote.header ? withCalloutTitle(this.quote.header, this.title) : "引用"}\n${this.body}`];
		for (const editor of this.mounts.values()) {
			const inner = editor.editorView.state.field(editingField, false)?.widget;
			if (inner) drafts.push(...inner.pendingDrafts());
		}
		return drafts;
	}

	finish(direction: ExitDirection = 1, automatic = false): void {
		queueMicrotask(() => {
			if (this.disposed) return;
			let current = this.parent.state.field(editingField, false);
			if (!current || current.widget !== this) return;
			if (this.parent.compositionStarted || this.titleView?.compositionStarted ||
				[...this.mounts.values()].some((editor) => editor.editorView.compositionStarted)) return;
			for (const editor of this.mounts.values()) {
				const inner = editor.editorView.state.field(editingField, false);
				if (inner && !inner.widget.flush()) {
					new Notice("内側の引用の同期が停止しています。本文をコピーし、内側の編集を先に閉じてください。");
					return;
				}
			}
			if (!this.sync() && automatic) return;
			current = this.parent.state.field(editingField, false)!;
			const doc = this.parent.state.doc;
			const firstLine = doc.lineAt(current.from);
			const lastLine = doc.lineAt(current.to);
			let anchor: number;
			let changes: { from: number; insert: string } | undefined;
			if (direction < 0) {
				anchor = firstLine.number > 1 ? doc.line(firstLine.number - 1).to : 0;
				if (firstLine.number === 1 && !this.parent.state.readOnly) changes = { from: 0, insert: "\n" };
				else if (firstLine.number === 1) anchor = Math.min(doc.length, current.to + 1);
			} else {
				anchor = lastLine.number < doc.lines ? doc.line(lastLine.number + 1).from : doc.length + 2;
				if (lastLine.number === doc.lines) {
					if (!this.parent.state.readOnly) changes = { from: doc.length, insert: "\n\n" };
					else anchor = Math.max(0, current.from - 1);
				}
			}
			this.parent.dispatch({
				changes,
				effects: stopEditing.of(this),
				selection: { anchor },
				annotations: isolateHistory.of("after"),
				scrollIntoView: true,
			});
			this.parent.focus();
		});
	}

	ignoreEvent(): boolean { return true; }

	destroy(root: HTMLElement): void {
		// Retain the actual editor (including undo and nested drafts) while offscreen.
		// The view plugin disposes it when the parent editor is closed or reconfigured.
		if (this.parent.state.field(editingField, false)?.widget !== this) this.dispose();
	}

	dispose(): void {
		this.disposed = true;
		this.typeModal?.close();
		for (const editor of this.mounts.values()) editor.unload();
		this.mounts.clear();
		this.titleEditor?.unload();
		this.titleEditor = undefined;
		this.titleHost = undefined;
		this.renderer.unload();
		this.statuses.clear();
		this.root = undefined;
	}
}
