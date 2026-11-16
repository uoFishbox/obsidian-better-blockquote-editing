import { App, SuggestModal } from "obsidian";
import { isolateHistory } from "@codemirror/commands";
import { Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/** Replace only the identifier, preserving metadata, folding, title and body. */
export function changeCalloutType(view: EditorView, from: number, type: string): void {
	if (view.state.readOnly) return;
	const line = view.state.doc.lineAt(from);
	const match = /^(?: {0,3}>[ \t]?)+\[!([^|\]]+)/.exec(line.text);
	if (!match || match[1] === type) return;
	const start = line.from + match[0].length - match[1]!.length;
	view.dispatch({ changes: { from: start, to: start + match[1]!.length, insert: type },
		annotations: [Transaction.userEvent.of("input.better-blockquote.type"), isolateHistory.of("full")] });
}

const types = [
	"note", "abstract", "summary", "tldr", "info", "todo", "tip", "hint", "important",
	"success", "check", "done", "question", "help", "faq", "warning", "caution", "attention",
	"failure", "fail", "missing", "danger", "error", "bug", "example", "quote", "cite",
];

export class CalloutTypeModal extends SuggestModal<string> {
	constructor(app: App, private current: string, private choose: (type: string) => void, private closed: () => void) {
		super(app);
		this.modalEl.addClass("bbe-callout-type-modal");
		this.setPlaceholder("Search or enter a callout type…");
		this.limit = types.length + 2;
	}

	getSuggestions(query: string): string[] {
		const value = query.trim().toLowerCase();
		const suggestions = [...new Set([this.current, ...types])].filter(type => type.toLowerCase().includes(value));
		if (/^[a-z0-9-]+$/.test(value) && !suggestions.includes(value)) suggestions.push(value);
		return suggestions;
	}

	renderSuggestion(type: string, el: HTMLElement): void {
		el.setText(type === this.current ? `${type} (current)` : type);
	}

	onChooseSuggestion(type: string): void {
		this.choose(type);
	}

	onClose(): void {
		super.onClose();
		this.closed();
	}
}
