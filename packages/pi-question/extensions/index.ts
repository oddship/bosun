/**
 * pi-question — Enhanced interactive question tool for Pi.
 *
 * Features:
 * - Options list with descriptions
 * - Header display (for context like "Priority", "Triage")
 * - Multiple selection mode (Space to toggle, Enter to confirm)
 * - Free-form "Other" option for custom input
 * - Numbered options for quick reference
 * - Custom TUI rendering
 *
 * Enhanced question tool with TUI, multi-select, and custom input.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, Text, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

interface OptionWithDesc {
  label: string;
  description?: string;
}

type DisplayOption = OptionWithDesc & { isOther?: boolean };

interface QuestionDetails {
  header?: string;
  question: string;
  options: string[];
  answer: string | string[] | null;
  wasCustom?: boolean;
  multiple?: boolean;
}

const OptionSchema = Type.Object({
  label: Type.String({ description: "Display label for the option" }),
  description: Type.Optional(Type.String({ description: "Optional description shown below label" })),
});

const QuestionParams = Type.Object({
  question: Type.String({ description: "The question to ask the user" }),
  options: Type.Array(OptionSchema, { description: "Options for the user to choose from" }),
  header: Type.Optional(Type.String({ description: "Short header displayed above the question (e.g., 'Priority', 'Triage')" })),
  multiple: Type.Optional(Type.Boolean({ description: "Allow selecting multiple options. User presses Space to toggle, Enter to confirm." })),
});

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "question",
    label: "Question",
    description: "Ask the user a question and let them pick from options. Supports headers for context and multiple selection for bulk operations.",
    parameters: QuestionParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        return {
          content: [{ type: "text", text: "Error: UI not available (running in non-interactive mode)" }],
          details: {
            header: params.header,
            question: params.question,
            options: params.options.map((o) => o.label),
            answer: null,
            multiple: params.multiple,
          } as QuestionDetails,
        };
      }

      if (params.options.length === 0) {
        return {
          content: [{ type: "text", text: "Error: No options provided" }],
          details: { header: params.header, question: params.question, options: [], answer: null } as QuestionDetails,
        };
      }

      const isMultiple = params.multiple === true;
      const allOptions: DisplayOption[] = isMultiple
        ? [...params.options]
        : [...params.options, { label: "Type something.", isOther: true }];

      const result = await ctx.ui.custom<{
        answer: string | string[];
        wasCustom: boolean;
        index?: number;
        indices?: number[];
      } | null>(
        (tui, theme, _kb, done) => {
          let optionIndex = 0;
          let editMode = false;
          let cachedLines: string[] | undefined;
          const selected = new Set<number>();

          const editorTheme: EditorTheme = {
            borderColor: (s) => theme.fg("accent", s),
            selectList: {
              selectedPrefix: (t) => theme.fg("accent", t),
              selectedText: (t) => theme.fg("accent", t),
              description: (t) => theme.fg("muted", t),
              scrollInfo: (t) => theme.fg("dim", t),
              noMatch: (t) => theme.fg("warning", t),
            },
          };
          const editor = new Editor(tui, editorTheme);

          editor.onSubmit = (value) => {
            const trimmed = value.trim();
            if (trimmed) {
              done({ answer: trimmed, wasCustom: true });
            } else {
              editMode = false;
              editor.setText("");
              refresh();
            }
          };

          function refresh() {
            cachedLines = undefined;
            tui.requestRender();
          }

          function handleInput(data: string) {
            if (editMode) {
              if (matchesKey(data, Key.escape)) {
                editMode = false;
                editor.setText("");
                refresh();
                return;
              }
              editor.handleInput(data);
              refresh();
              return;
            }

            if (matchesKey(data, Key.up)) {
              optionIndex = Math.max(0, optionIndex - 1);
              refresh();
              return;
            }
            if (matchesKey(data, Key.down)) {
              optionIndex = Math.min(allOptions.length - 1, optionIndex + 1);
              refresh();
              return;
            }

            if (isMultiple && data === " ") {
              if (selected.has(optionIndex)) selected.delete(optionIndex);
              else selected.add(optionIndex);
              refresh();
              return;
            }

            if (matchesKey(data, Key.enter)) {
              if (isMultiple) {
                if (selected.size === 0) {
                  done(null);
                } else {
                  const indices = Array.from(selected).sort((a, b) => a - b);
                  const answers = indices.map((i) => allOptions[i].label);
                  done({ answer: answers, wasCustom: false, indices: indices.map((i) => i + 1) });
                }
                return;
              }

              const opt = allOptions[optionIndex];
              if (opt.isOther) {
                editMode = true;
                refresh();
              } else {
                done({ answer: opt.label, wasCustom: false, index: optionIndex + 1 });
              }
              return;
            }

            if (matchesKey(data, Key.escape)) done(null);
          }

          function render(width: number): string[] {
            if (cachedLines) return cachedLines;

            const lines: string[] = [];
            const add = (s: string) => lines.push(truncateToWidth(s, width));

            add(theme.fg("accent", "─".repeat(width)));
            if (params.header) add(theme.fg("accent", theme.bold(` [${params.header}]`)));
            add(theme.fg("text", ` ${params.question}`));
            lines.push("");

            for (let i = 0; i < allOptions.length; i++) {
              const opt = allOptions[i];
              const isCursor = i === optionIndex;
              const isSelected = selected.has(i);
              const isOther = opt.isOther === true;

              let prefix: string;
              if (isMultiple) {
                const checkbox = isSelected ? "[x]" : "[ ]";
                prefix = isCursor ? theme.fg("accent", `> ${checkbox} `) : `  ${checkbox} `;
              } else {
                prefix = isCursor ? theme.fg("accent", "> ") : "  ";
              }

              if (isOther && editMode) {
                add(prefix + theme.fg("accent", `${i + 1}. ${opt.label} ✎`));
              } else if (isCursor) {
                add(prefix + theme.fg("accent", `${i + 1}. ${opt.label}`));
              } else if (isSelected) {
                add(prefix + theme.fg("success", `${i + 1}. ${opt.label}`));
              } else {
                add(prefix + theme.fg("text", `${i + 1}. ${opt.label}`));
              }

              if (opt.description) {
                const indent = isMultiple ? "       " : "     ";
                add(`${indent}${theme.fg("muted", opt.description)}`);
              }
            }

            if (editMode) {
              lines.push("");
              add(theme.fg("muted", " Your answer:"));
              for (const line of editor.render(width - 2)) add(` ${line}`);
            }

            lines.push("");
            if (editMode) {
              add(theme.fg("dim", " Enter to submit • Esc to go back"));
            } else if (isMultiple) {
              add(theme.fg("dim", " ↑↓ navigate • Space to toggle • Enter to confirm • Esc to cancel"));
              if (selected.size > 0) add(theme.fg("muted", ` Selected: ${selected.size} item${selected.size > 1 ? "s" : ""}`));
            } else {
              add(theme.fg("dim", " ↑↓ navigate • Enter to select • Esc to cancel"));
            }
            add(theme.fg("accent", "─".repeat(width)));

            cachedLines = lines;
            return lines;
          }

          return {
            render,
            invalidate: () => { cachedLines = undefined; },
            handleInput,
          };
        },
      );

      const simpleOptions = params.options.map((o) => o.label);

      if (!result) {
        return {
          content: [{ type: "text", text: "User cancelled the selection" }],
          details: { header: params.header, question: params.question, options: simpleOptions, answer: null, multiple: isMultiple } as QuestionDetails,
        };
      }

      if (result.wasCustom) {
        return {
          content: [{ type: "text", text: `User wrote: ${result.answer}` }],
          details: { header: params.header, question: params.question, options: simpleOptions, answer: result.answer, wasCustom: true } as QuestionDetails,
        };
      }

      if (Array.isArray(result.answer)) {
        const answers = result.answer as string[];
        const indices = result.indices || [];
        const display = indices.map((idx, i) => `${idx}. ${answers[i]}`).join(", ");
        return {
          content: [{ type: "text", text: `User selected: ${display}` }],
          details: { header: params.header, question: params.question, options: simpleOptions, answer: answers, wasCustom: false, multiple: true } as QuestionDetails,
        };
      }

      return {
        content: [{ type: "text", text: `User selected: ${result.index}. ${result.answer}` }],
        details: { header: params.header, question: params.question, options: simpleOptions, answer: result.answer, wasCustom: false } as QuestionDetails,
      };
    },

    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("question "));
      if (args.header) text += theme.fg("accent", `[${args.header}] `);
      text += theme.fg("muted", args.question);
      const opts = Array.isArray(args.options) ? args.options : [];
      if (opts.length) {
        const labels = opts.map((o: OptionWithDesc) => o.label);
        const withOther = args.multiple ? labels : [...labels, "Type something."];
        text += `\n${theme.fg("dim", `  Options: ${withOther.map((o, i) => `${i + 1}. ${o}`).join(", ")}`)}`;
        if (args.multiple) text += theme.fg("dim", " (multiple)");
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme) {
      const details = result.details as QuestionDetails | undefined;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }
      if (details.answer === null) return new Text(theme.fg("warning", "Cancelled"), 0, 0);
      if (details.wasCustom) {
        return new Text(theme.fg("success", "✓ ") + theme.fg("muted", "(wrote) ") + theme.fg("accent", String(details.answer)), 0, 0);
      }
      if (Array.isArray(details.answer)) {
        const display = details.answer.map((a) => {
          const idx = details.options.indexOf(a) + 1;
          return idx > 0 ? `${idx}. ${a}` : a;
        }).join(", ");
        return new Text(theme.fg("success", "✓ ") + theme.fg("muted", `(${details.answer.length}) `) + theme.fg("accent", display), 0, 0);
      }
      const idx = details.options.indexOf(details.answer) + 1;
      const display = idx > 0 ? `${idx}. ${details.answer}` : details.answer;
      return new Text(theme.fg("success", "✓ ") + theme.fg("accent", display), 0, 0);
    },
  });
}
