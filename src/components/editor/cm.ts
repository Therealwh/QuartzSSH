// CodeMirror 6 integration. This is the only module that statically imports
// the @codemirror packages; FileEditor loads it through a dynamic import()
// so every editor dependency lives in its own lazy chunk (same strategy as
// xterm in vite.config.ts, which maps "@xterm" to a dedicated chunk).

import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  defaultHighlightStyle,
  syntaxHighlighting,
  HighlightStyle,
  StreamLanguage,
} from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { tags } from "@lezer/highlight";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { yaml } from "@codemirror/lang-yaml";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
// The legacy "properties" mode is the KEY=VALUE parser used for ini/conf files.
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { editorLanguageFor, type EditorLanguageKind } from "./language";

function languageExtension(kind: EditorLanguageKind): Extension | null {
  switch (kind) {
    case "javascript":
      return javascript();
    case "jsx":
      return javascript({ jsx: true });
    case "typescript":
      return javascript({ typescript: true });
    case "tsx":
      return javascript({ typescript: true, jsx: true });
    case "json":
      return json();
    case "python":
      return python();
    case "yaml":
      return yaml();
    case "shell":
      return StreamLanguage.define(shell);
    case "toml":
      return StreamLanguage.define(toml);
    case "ini":
      return StreamLanguage.define(properties);
    case "html":
      return html();
    case "css":
      return css();
    case "plain":
      return null;
  }
}

// Layout and chrome bound to the app's CSS variables --q-*: the editor
// follows the active QuartzSSH theme instantly, with no view rebuild.
const layoutTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--q-bg)", color: "var(--q-text)" },
  ".cm-scroller": { overflow: "auto" },
  ".cm-content": { caretColor: "var(--q-accent)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--q-accent)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--q-active)",
  },
  ".cm-gutters": { backgroundColor: "var(--q-panel)", color: "var(--q-muted)", border: "none" },
  ".cm-activeLineGutter": { backgroundColor: "var(--q-elevated)", color: "var(--q-text)" },
  ".cm-panels": { backgroundColor: "var(--q-panel)", color: "var(--q-text)" },
  ".cm-panels-bottom": { borderTop: "1px solid var(--q-border)" },
  ".cm-tooltip": {
    backgroundColor: "var(--q-elevated)",
    border: "1px solid var(--q-border)",
    color: "var(--q-text)",
  },
  ".cm-searchMatch": { outline: "1px solid var(--q-warning)" },
  ".cm-searchMatch-selected": { backgroundColor: "var(--q-hover)" },
});

// Dark syntax colors on the same variables: the default highlight style is
// tuned for light backgrounds and is unreadable on dark ones, so dark themes
// get this compact mapping instead. Light themes use the default style.
const darkSyntaxStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword], color: "var(--q-accent)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--q-success)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--q-warning)" },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
    color: "var(--q-muted)",
    fontStyle: "italic",
  },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: "var(--q-warning)",
  },
  { tag: tags.definition(tags.variableName), color: "var(--q-text)" },
  { tag: tags.tagName, color: "var(--q-danger)" },
  { tag: tags.attributeName, color: "var(--q-warning)" },
  { tag: tags.heading, color: "var(--q-accent)" },
]);

function themeExtensions(isDark: boolean): Extension[] {
  return isDark
    ? [syntaxHighlighting(darkSyntaxStyle)]
    : [syntaxHighlighting(defaultHighlightStyle)];
}

const fontTheme = (family: string, size: number) =>
  EditorView.theme({
    ".cm-content": { fontFamily: family, fontSize: `${size}px` },
    ".cm-gutters": { fontFamily: family, fontSize: `${size}px` },
  });

export interface CreateEditorOptions {
  parent: HTMLElement;
  doc: string;
  path: string;
  isDark: boolean;
  fontFamily: string;
  fontSize: number;
  /** Current saved baseline, used to compute the dirty flag. */
  getBaseline: () => string;
  onSave: () => void;
  onUpdate: (line: number, col: number, dirty: boolean) => void;
}

export interface CreatedEditor {
  view: EditorView;
  /** Re-bind the syntax theme after the app theme switches light/dark. */
  setDark: (isDark: boolean) => void;
  setFont: (family: string, size: number) => void;
}

export function createCodeEditor(options: CreateEditorOptions): CreatedEditor {
  const themeCompartment = new Compartment();
  const fontCompartment = new Compartment();

  const extensions: Extension[] = [
    layoutTheme,
    history(),
    search(),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      indentWithTab,
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          options.onSave();
          return true;
        },
      },
    ]),
    themeCompartment.of(themeExtensions(options.isDark)),
    fontCompartment.of(fontTheme(options.fontFamily, options.fontSize)),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged && !update.selectionSet) return;
      const pos = update.state.selection.main.head;
      const line = update.state.doc.lineAt(pos);
      const baseline = options.getBaseline();
      const dirty =
        update.state.doc.length !== baseline.length ||
        update.state.doc.toString() !== baseline;
      options.onUpdate(line.number, pos - line.from + 1, dirty);
    }),
  ];

  const lang = languageExtension(editorLanguageFor(options.path));
  if (lang) extensions.push(lang);

  const view = new EditorView({
    state: EditorState.create({ doc: options.doc, extensions }),
    parent: options.parent,
  });

  return {
    view,
    setDark: (isDark) => {
      view.dispatch({ effects: themeCompartment.reconfigure(themeExtensions(isDark)) });
    },
    setFont: (family, size) => {
      view.dispatch({ effects: fontCompartment.reconfigure(fontTheme(family, size)) });
    },
  };
}
