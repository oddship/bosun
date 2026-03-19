#!/usr/bin/env bun
import { readFile, writeFile } from "fs/promises";
import matter from "gray-matter";

const path = process.argv[2];
if (!path) {
  console.error("Usage: load.ts <path>");
  process.exit(1);
}

try {
  const content = await readFile(path, "utf-8");
  const { data, content: body } = matter(content);

  // Update status
  data.status = "picked_up";
  data.picked_up_at = new Date().toISOString();

  // Rebuild file
  const updatedContent = matter.stringify(body, data);
  await writeFile(path, updatedContent);

  // Output full content for agent to present
  console.log(updatedContent);
} catch (err) {
  console.error(`Error loading document: ${err}`);
  process.exit(1);
}
