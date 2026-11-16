import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const vault = process.argv[2];
if (!vault) throw new Error("Specify a test vault: npm run test:obsidian -- <vault-name>");
const script = fileURLToPath(new URL(process.argv[3] ?? "./native-smoke.js", import.meta.url));
const code = `await eval(require('fs').readFileSync(${JSON.stringify(script)}, 'utf8'))`;
const result = execFileSync(process.platform === "win32" ? "Obsidian.com" : "obsidian",
	[`vault=${vault}`, "eval", `code=${code}`], { encoding: "utf8", timeout: 60_000 });
process.stdout.write(result);
if (!result.includes('"passed":') || result.includes("Error:")) process.exitCode = 1;
