/**
 * Assertion checker for eval tasks.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { State } from "pi-exec";
import type { Assertion, AssertionResult } from "./types.js";

/**
 * Check all assertions against the final state and working directory.
 */
export function checkAssertions(
  assertions: Assertion[],
  state: State,
  workDir: string,
): AssertionResult[] {
  return assertions.map((assertion) => {
    try {
      switch (assertion.type) {
        case "state_field": {
          const actual = getNestedValue(state, assertion.path);
          const passed = assertion.expected !== undefined
            ? deepEqual(actual, assertion.expected)
            : actual !== undefined;
          return { assertion, passed, actual };
        }

        case "state_matches": {
          // Check that a state field matches a regex
          const actual = getNestedValue(state, assertion.path);
          const passed = typeof actual === "string" && typeof assertion.expected === "string"
            ? new RegExp(assertion.expected).test(actual)
            : false;
          return { assertion, passed, actual };
        }

        case "file_exists": {
          const fullPath = join(workDir, assertion.path);
          const passed = existsSync(fullPath);
          return { assertion, passed };
        }

        case "file_contains": {
          const fullPath = join(workDir, assertion.path);
          if (!existsSync(fullPath)) {
            return { assertion, passed: false, error: "File does not exist" };
          }
          const content = readFileSync(fullPath, "utf-8");
          const passed = typeof assertion.expected === "string"
            ? content.includes(assertion.expected)
            : false;
          return { assertion, passed, actual: content.slice(0, 200) };
        }

        default:
          return { assertion, passed: false, error: `Unknown assertion type: ${assertion.type}` };
      }
    } catch (err) {
      return { assertion, passed: false, error: String(err) };
    }
  });
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object" || a === null || b === null) return false;
  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) =>
    deepEqual(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
    ),
  );
}
