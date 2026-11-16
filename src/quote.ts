import { parser } from "@lezer/markdown";

export interface QuoteBlock {
	from: number;
	to: number;
	source: string;
	body: string;
	header: string | null;
	prefix: string;
	depth: number;
	cursor: number;
	titleCursor: number | null;
}

export function calloutTitle(header: string | null): { text: string; from: number } {
	const from = header ? /^\[![^\]]+\][+-]?[ \t]*/.exec(header)?.[0].length ?? 0 : 0;
	return { text: header?.slice(from) ?? "", from };
}

export function withCalloutTitle(header: string, title: string): string {
	const { from } = calloutTitle(header);
	const prefix = header.slice(0, from);
	return prefix + (title && !/[ \t]$/.test(prefix) ? " " : "") + title;
}

export function titleOffsetToSource(quote: QuoteBlock, source: string, offset: number): number {
	const line = source.split("\n", 1)[0]!;
	const stripped = stripPrefix(line, quote.depth);
	const title = calloutTitle(stripped.text);
	return stripped.length + title.from + Math.max(0, Math.min(title.text.length, offset));
}

/** Strip the enclosing markers, retaining Markdown indentation and nested content. */
function stripPrefix(line: string, depth: number): { text: string; length: number } {
	let length = 0;
	for (let i = 0; i < depth; i++) {
		const match = /^ {0,3}>[ \t]?/.exec(line.slice(length));
		if (!match) break; // Lazy paragraph continuations need not have every marker.
		length += match[0].length;
	}
	return { text: line.slice(length), length };
}

/** Find an actual Markdown blockquote, never a > inside a code fence. */
export function findQuote(text: string, cursor: number, outermost = false): QuoteBlock | null {
	const frontmatter = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(text);
	if (frontmatter && cursor < frontmatter[0].length) return null;
	let range: { from: number; to: number; depth: number } | null = null;
	parser.parse(text).iterate({
		enter(node) {
			if (node.from > cursor || node.to < cursor) return false;
			if (node.name !== "Blockquote") return;
			if (outermost && range) return false;
			let depth = 1;
			for (let parent = node.node.parent; parent; parent = parent.parent) {
				// List prefixes require another serialization context. Don't partially edit one.
				if (parent.name === "ListItem") return false;
				if (parent.name === "Blockquote") depth++;
			}
			range = { from: node.from, to: node.to, depth };
		},
	});
	if (!range) return null;
	const selected = range as { from: number; to: number; depth: number };
	const from = text.lastIndexOf("\n", selected.from - 1) + 1;
	const lineEnd = text.indexOf("\n", selected.to);
	const to = lineEnd === -1 ? text.length : lineEnd;
	const source = text.slice(from, to);
	const lines = source.split("\n");
	const stripped = lines.map((line) => stripPrefix(line, selected.depth));
	const header = /^\[![^\]\r\n]+\][+-]?(?:[ \t].*)?$/.test(stripped[0]!.text)
		? stripped[0]!.text : null;
	const bodyLines = stripped.slice(header ? 1 : 0);
	const body = bodyLines.map((line) => line.text).join("\n");
	const beforeCursor = text.slice(from, cursor).split("\n");
	const row = beforeCursor.length - 1;
	const bodyRow = row - (header ? 1 : 0);
	const ch = Math.max(0, beforeCursor[row]!.length - (stripped[row]?.length ?? 0));
	const bodyCursor = bodyRow < 0 ? 0 : bodyLines.slice(0, bodyRow).reduce(
		(offset, line) => offset + line.text.length + 1, 0,
	) + ch;
	let prefix = lines[0]!.slice(0, stripped[0]!.length);
	if (!/[ \t]$/.test(prefix)) prefix += " ";
	return { from, to, source, body, header, prefix, depth: selected.depth,
		cursor: Math.min(body.length, bodyCursor),
		titleCursor: header && row === 0 ? Math.max(0, ch - calloutTitle(header).from) : null };
}

export function serializeQuote(quote: QuoteBlock, body: string, title = calloutTitle(quote.header).text): string {
	const titleChanged = !!quote.header && title !== calloutTitle(quote.header).text;
	const original = quote.source.split("\n", 1)[0]!;
	const header = titleChanged ? original.slice(0, original.length - quote.header!.length) + withCalloutTitle(quote.header!, title) : original;
	if (body === quote.body) {
		if (!titleChanged) return quote.source;
		return header + quote.source.slice(original.length);
	}
	const lines = body.split(/\r?\n/).map((line) => quote.prefix + line);
	if (!quote.header) return lines.join("\n");
	return body === "" ? header : [header, ...lines].join("\n");
}

/** Map an embedded body offset into its current serialized quote, including markers. */
export function bodyOffsetToSource(quote: QuoteBlock, source: string, offset: number): number {
	let sourceOffset = 0;
	let bodyOffset = 0;
	for (const [row, line] of source.split("\n").entries()) {
		if (!(quote.header && row === 0)) {
			const stripped = stripPrefix(line, quote.depth);
			if (offset <= bodyOffset + stripped.text.length) {
				return sourceOffset + stripped.length + Math.max(0, offset - bodyOffset);
			}
			bodyOffset += stripped.text.length + 1;
		}
		sourceOffset += line.length + 1;
	}
	// A header-only callout has no source body line yet.
	return source.length;
}

/** Map a source offset back into the body; headers and markers clamp to the body. */
export function sourceOffsetToBody(quote: QuoteBlock, source: string, offset: number): number {
	let sourceOffset = 0;
	let bodyOffset = 0;
	for (const [row, line] of source.split("\n").entries()) {
		if (quote.header && row === 0) {
			if (offset <= line.length) return 0;
		} else {
			const stripped = stripPrefix(line, quote.depth);
			if (offset <= sourceOffset + line.length) {
				return bodyOffset + Math.max(0, offset - sourceOffset - stripped.length);
			}
			bodyOffset += stripped.text.length + 1;
		}
		sourceOffset += line.length + 1;
	}
	return Math.max(0, bodyOffset - 1);
}
