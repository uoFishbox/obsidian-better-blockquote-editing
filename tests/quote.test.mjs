import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({ entryPoints: ["src/quote.ts"], bundle: true,
	format: "esm", platform: "node", write: false });
const { bodyOffsetToSource, calloutTitle, findQuote, serializeQuote, sourceOffsetToBody, titleOffsetToSource } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`,
);

test("title edits preserve the complete body, quote prefixes, metadata and folding", () => {
	for (const source of [
		"> [!question] Title\n> - [[古代懐疑主義入門――判断保留の十の方式]]\n> ",
		"  >[!custom|wide]-\tTitle\n > body\nlazy continuation\n>",
		"> > [!tip]+ Title\n> >body\n> > ",
		"> [!question] Title",
	]) {
		const quote = findQuote(source, source.indexOf("Title") + 2);
		assert.equal(quote.titleCursor, 2);
		assert.equal(serializeQuote(quote, quote.body, "日本語 **変更**"), source.replace("Title", "日本語 **変更**"));
		assert.equal(serializeQuote(quote, quote.body, ""), source.replace("Title", ""));
		assert.equal(serializeQuote(quote, quote.body, "Title"), source);
		for (let offset = 0; offset <= 5; offset++) {
			assert.equal(titleOffsetToSource(quote, quote.source, offset), quote.source.indexOf("Title") + offset);
			assert.equal(findQuote(source, quote.from + titleOffsetToSource(quote, quote.source, offset)).titleCursor, offset);
		}
	}
});

test("missing titles and simultaneous title/body changes serialize as valid callouts", () => {
	for (const source of ["> [!note]", "> [!tip]-\n> ", "> [!custom|wide]+\t\n> body"]) {
		const quote = findQuote(source, 2);
		assert.equal(calloutTitle(quote.header).text, "");
		const updated = serializeQuote(quote, "new\n\nbody", "Title");
		const parsed = findQuote(updated, updated.indexOf("Title"));
		assert.equal(calloutTitle(parsed.header).text, "Title");
		assert.equal(parsed.body, "new\n\nbody");
		assert.equal(updated.slice(titleOffsetToSource(parsed, updated, 0), titleOffsetToSource(parsed, updated, 5)), "Title");
		assert.equal(findQuote(serializeQuote(quote, "", "Title"), 2).body, "");
	}
	const plain = findQuote("> body", 3);
	assert.equal(plain.titleCursor, null);
	assert.equal(serializeQuote(plain, "changed", "ignored"), "> changed");
});

test("callout body excludes its header, preserving folding, title and surrounding text", () => {
	const text = "before\n\n> [!custom-type]- タイトル\n> 最初\n>\n> **太字**\n\nafter";
	const quote = findQuote(text, text.indexOf("最初") + 1);
	assert.equal(quote.header, "[!custom-type]- タイトル");
	assert.equal(quote.body, "最初\n\n**太字**");
	assert.equal(quote.cursor, 1);
	const result = text.slice(0, quote.from) + serializeQuote(quote, "更新\n\n- item\n") + text.slice(quote.to);
	assert.equal(result, "before\n\n> [!custom-type]- タイトル\n> 更新\n> \n> - item\n> \n\nafter");
});

test("unmodified content round trips byte for byte, including unusual spacing", () => {
	for (const text of [">one\n>\n>   two", "  > text\n  >\n  > last", "> [!note]+", "> [!tip]\n>"]) {
		const quote = findQuote(text, 0 === text.indexOf(">") ? 0 : text.indexOf(">"));
		assert.ok(quote);
		assert.equal(serializeQuote(quote, quote.body), text);
	}
});

test("empty quotes and header-only callouts remain editable", () => {
	const quote = findQuote(">", 1);
	assert.equal(quote.body, "");
	assert.equal(serializeQuote(quote, "new\nline"), "> new\n> line");
	const callout = findQuote("> [!note]", 5);
	assert.equal(callout.body, "");
	assert.equal(serializeQuote(callout, "body"), "> [!note]\n> body");
	assert.equal(serializeQuote(findQuote("> [!tip]\n> body", 12), ""), "> [!tip]");
});

test("nested quote edits restore all ancestors without touching the outer body", () => {
	const text = "> outer\n>\n> > [!note] Inner\n> > one\n> > two\n>\n> after";
	const quote = findQuote(text, text.indexOf("one") + 2);
	assert.equal(quote.depth, 2);
	assert.equal(quote.body, "one\ntwo");
	assert.equal(quote.cursor, 2);
	assert.equal(text.slice(0, quote.from) + serializeQuote(quote, "new\n\nend") + text.slice(quote.to),
		"> outer\n>\n> > [!note] Inner\n> > new\n> > \n> > end\n>\n> after");
});

test("editing an outer quote retains inner quote markers and code indentation", () => {
	const text = "> start\n>\n> > nested\n>\n>     code";
	const quote = findQuote(text, 3);
	assert.equal(quote.body, "start\n\n> nested\n\n    code");
});

test("UI chooses the outermost quote and retains cursor position within nested content", () => {
	const text = "> [!note] Outer\n> start\n>\n> > [!tip] Inner\n> > body\n>\n> end";
	const quote = findQuote(text, text.indexOf("body") + 2, true);
	assert.equal(quote.depth, 1);
	assert.equal(quote.from, 0);
	assert.equal(quote.body.slice(quote.cursor - 2, quote.cursor + 2), "body");
});

test("lazy continuations are included and normalized only when changed", () => {
	const quote = findQuote("> first\nlazy continuation\n\nend", 15);
	assert.equal(quote.body, "first\nlazy continuation");
	assert.equal(serializeQuote(quote, quote.body), "> first\nlazy continuation");
	assert.equal(serializeQuote(quote, "first\nchanged"), "> first\n> changed");
});

test("fenced code, indented code, frontmatter and list-contained quotes aren't targets", () => {
	for (const text of ["```md\n> example\n```", "~~~\n> example\n~~~", "    > code",
		"---\ntext: |\n  > yaml\n---", "- > list\n  > continuation", "plain text"]) {
		const at = text.indexOf(">") + 1;
		assert.equal(findQuote(text, at), null, text);
	}
});

test("literal > in a fenced code block inside a quote stays part of the body", () => {
	const text = "> ```md\n> > example\n> ```";
	const quote = findQuote(text, text.indexOf("example"));
	assert.equal(quote.depth, 1);
	assert.equal(quote.body, "```md\n> example\n```");
});

test("separate quotes and text outside the quote are never included", () => {
	const text = "> first\n\n> second\n\nend";
	const quote = findQuote(text, text.indexOf("second"));
	assert.equal(quote.source, "> second");
	assert.equal(findQuote(text, text.indexOf("end")), null);
});

test("body offsets map to original source across headers, unusual prefixes and lazy lines", () => {
	for (const text of ["> [!note]- Title\n> first\n>\n> last", "  >first\n > \n>\tlast",
		"> first\nlazy continuation", "> outer\n>\n> > [!tip] Inner\n> > 日本語\n> > end"]) {
		const quote = findQuote(text, text.indexOf("日本語") >= 0 ? text.indexOf("日本語") : text.indexOf("first"));
		for (let at = 0; at <= quote.body.length; at++) {
			const mapped = bodyOffsetToSource(quote, quote.source, at);
			assert.equal(findQuote(text, quote.from + mapped).cursor, at, `${text}: ${at}`);
			assert.equal(sourceOffsetToBody(quote, quote.source, mapped), at, `${text}: inverse ${at}`);
		}
	}
});

test("body offsets map to edited serialized text, including newlines and an empty callout", () => {
	const quote = findQuote("> [!note] Title\n> old", 20);
	const body = "日本語\n\nlast\n";
	const source = serializeQuote(quote, body);
	assert.equal(bodyOffsetToSource(quote, source, body.indexOf("last") + 2), source.indexOf("last") + 2);
	assert.equal(bodyOffsetToSource(quote, source, body.length), source.length);
	const empty = serializeQuote(quote, "");
	assert.equal(bodyOffsetToSource(quote, empty, 0), empty.length);
});
