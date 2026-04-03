#!/usr/bin/env bun
/**
 * Generate an image using Gemini's image generation API.
 *
 * Usage: bun generate.ts <prompt> <output_path> [model] [ref_image...]
 *
 * Models:
 *   gemini-2.5-flash-image         — Nano Banana, fast + good quality (default)
 *   gemini-3.1-flash-image-preview — Nano Banana 2, latest, up to 4K
 *   gemini-3-pro-image-preview     — Nano Banana Pro, highest fidelity
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

// --- Parse args ---
const args = process.argv.slice(2);
if (args.length < 2) {
	console.error("Usage: bun generate.ts <prompt> <output_path> [model] [ref_image...]");
	process.exit(1);
}

const prompt = args[0];
const output = args[1];
const model = args[2] || "";
const refImages = args.slice(3).filter((f) => existsSync(f));

// --- Resolve API key ---
function findConfig(): { apiKey: string; defaultModel: string } {
	// 1. Environment variable
	if (process.env.GEMINI_API_KEY) {
		return { apiKey: process.env.GEMINI_API_KEY, defaultModel: "" };
	}

	// 2. .pi/pi-img-gen.json (search upward)
	let dir = process.cwd();
	while (dir !== "/") {
		const configPath = resolve(dir, ".pi/pi-img-gen.json");
		if (existsSync(configPath)) {
			const config = JSON.parse(readFileSync(configPath, "utf-8"));
			if (config.gemini_api_key) {
				return { apiKey: config.gemini_api_key, defaultModel: config.default_model || "" };
			}
		}
		dir = dirname(dir);
	}

	// 3. config.toml (search upward)
	dir = process.cwd();
	while (dir !== "/") {
		const tomlPath = resolve(dir, "config.toml");
		if (existsSync(tomlPath)) {
			const toml = readFileSync(tomlPath, "utf-8");
			const match = toml.match(/gemini_api_key\s*=\s*"([^"]+)"/);
			if (match) return { apiKey: match[1], defaultModel: "" };
		}
		dir = dirname(dir);
	}

	console.error("ERROR: No Gemini API key found.");
	console.error("Set GEMINI_API_KEY, or add [img_gen] gemini_api_key to config.toml and run 'just init'");
	process.exit(1);
}

const config = findConfig();
const apiKey = config.apiKey;
const resolvedModel = model || config.defaultModel || "gemini-2.5-flash-image";

// --- MIME type from extension ---
function getMime(path: string): string {
	const ext = extname(path).toLowerCase().slice(1);
	const map: Record<string, string> = {
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		png: "image/png",
		webp: "image/webp",
		gif: "image/gif",
	};
	return map[ext] || "image/png";
}

// --- Build request parts ---
const parts: any[] = [];

for (const ref of refImages) {
	const mime = getMime(ref);
	const data = readFileSync(ref).toString("base64");
	parts.push({ inlineData: { mimeType: mime, data } });
	console.error(`Reference: ${ref} (${mime}, ${Math.round(data.length / 1024)}KB b64)`);
}

parts.push({ text: prompt });

const payload = {
	contents: [{ parts }],
	generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
};

// --- Ensure output directory ---
mkdirSync(dirname(output), { recursive: true });

// --- Log ---
console.error(`Model: ${resolvedModel}`);
console.error(`Prompt: ${prompt.slice(0, 120)}${prompt.length > 120 ? "..." : ""}`);
console.error(`Output: ${output}`);

// --- Call API ---
const url = `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:generateContent?key=${apiKey}`;

const resp = await fetch(url, {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify(payload),
});

const result = await resp.json() as any;

// --- Check for errors ---
if (result.error) {
	console.error(`ERROR: ${result.error.message}`);
	process.exit(1);
}

// --- Extract image ---
const candidate = result.candidates?.[0]?.content?.parts;
if (!candidate) {
	console.error("ERROR: No candidates in response");
	process.exit(1);
}

const imagePart = candidate.find((p: any) => p.inlineData);
if (!imagePart) {
	const textPart = candidate.find((p: any) => p.text);
	console.error("ERROR: No image in response");
	if (textPart) console.error(textPart.text);
	process.exit(1);
}

const imageBuffer = Buffer.from(imagePart.inlineData.data, "base64");
writeFileSync(output, imageBuffer);

// --- Report ---
const textPart = candidate.find((p: any) => p.text);
if (textPart) console.error(`Note: ${textPart.text}`);

const size = statSync(output).size;
console.error(`Saved: ${output} (${Math.round(size / 1024)}KB)`);

// Print path to stdout for piping
console.log(output);
