/**
 * GPU auto-detection for node-llama-cpp Vulkan builds.
 *
 * On NixOS, Vulkan headers/loader live in /nix/store as transitive deps of Mesa
 * but aren't in standard paths. This module probes for them and sets env vars
 * so cmake finds Vulkan when building llama.cpp from source.
 *
 * On standard Linux distros (Ubuntu, Fedora, Arch), cmake finds Vulkan via
 * pkg-config or system paths — this module is a no-op.
 *
 * Must be imported BEFORE @tobilu/qmd (which triggers the llama.cpp build).
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

/**
 * Find a nix store package matching a prefix.
 * Extracts version from the package name and picks the highest version.
 * Returns the full store path or null.
 */
function findNixPkg(entries: string[], prefix: string): string | null {
  const matches = entries
    .filter(e => e.includes(prefix) && !e.endsWith(".drv"));
  if (matches.length === 0) return null;

  // Sort by extracted version (e.g., "vulkan-headers-1.4.309.0" → "1.4.309.0")
  matches.sort((a, b) => {
    const verA = a.match(new RegExp(`${prefix}([\\d.]+)`));
    const verB = b.match(new RegExp(`${prefix}([\\d.]+)`));
    if (!verA || !verB) return a.localeCompare(b);
    const partsA = verA[1].split(".").map(Number);
    const partsB = verB[1].split(".").map(Number);
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const diff = (partsA[i] || 0) - (partsB[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });

  return join("/nix/store", matches[matches.length - 1]);
}

/**
 * Probe for Vulkan SDK components in the nix store and configure env vars
 * for cmake/node-llama-cpp. No-op unless explicitly enabled via config.
 *
 * GPU is opt-in: set `gpu: true` in `[memory]` section of config.toml
 * (or `"gpu": true` in `.pi/pi-memory.json`).
 */
export function setupGpu(enabled: boolean): void {
  if (!enabled) {
    console.log("[memory-embed] GPU disabled (set gpu=true in [memory] config to enable)");
    return;
  }

  if (process.env.VULKAN_SDK) {
    console.log(`[memory-embed] Vulkan SDK: ${process.env.VULKAN_SDK} (from env)`);
    return;
  }

  if (!existsSync("/nix/store")) return;

  try {
    const entries = readdirSync("/nix/store");

    const headers = findNixPkg(entries, "vulkan-headers-");
    const loader = findNixPkg(entries, "vulkan-loader-");
    if (!headers || !loader) return;

    // Save originals for rollback if glslc is missing
    const originalCmakePrefixPath = process.env.CMAKE_PREFIX_PATH;

    // Point cmake at Vulkan headers + loader
    process.env.VULKAN_SDK = headers;
    process.env.CMAKE_PREFIX_PATH = [headers, loader, originalCmakePrefixPath]
      .filter(Boolean)
      .join(":");

    // Runtime: add loader lib to LD_LIBRARY_PATH
    const loaderLib = join(loader, "lib");
    if (existsSync(loaderLib)) {
      process.env.LD_LIBRARY_PATH = [loaderLib, process.env.LD_LIBRARY_PATH]
        .filter(Boolean)
        .join(":");
    }

    // Build: add glslc (from shaderc) to PATH for Vulkan shader compilation.
    // Without glslc, cmake can't compile Vulkan shaders and the build fails.
    let hasGlslc = false;
    const shaderc = findNixPkg(entries, "shaderc-");
    if (shaderc) {
      const shadercBin = join(shaderc, "bin");
      if (existsSync(join(shadercBin, "glslc"))) {
        process.env.PATH = [shadercBin, process.env.PATH].filter(Boolean).join(":");
        hasGlslc = true;
      }
    }
    // Also check if glslc is already on PATH (e.g., from nix develop flake)
    if (!hasGlslc) {
      try {
        execSync("which glslc", { stdio: "ignore" });
        hasGlslc = true;
      } catch {}
    }

    if (hasGlslc) {
      // All Vulkan build deps available — enable GPU backend
      process.env.NODE_LLAMA_CPP_CMAKE_OPTION_GGML_VULKAN = "ON";
      console.log(`[memory-embed] Vulkan SDK auto-detected (NixOS): ${headers}`);
    } else {
      // Headers found but no glslc — can't build Vulkan backend.
      // Revert env changes so node-llama-cpp doesn't attempt a Vulkan build.
      delete process.env.VULKAN_SDK;
      // Restore CMAKE_PREFIX_PATH to its original value (don't clobber unrelated entries)
      if (originalCmakePrefixPath !== undefined) {
        process.env.CMAKE_PREFIX_PATH = originalCmakePrefixPath;
      } else {
        delete process.env.CMAKE_PREFIX_PATH;
      }
      console.log("[memory-embed] Vulkan headers found but glslc missing — using CPU (add shaderc to devShell for GPU)");
    }
  } catch {
    // Silently fall back to CPU
  }
}
