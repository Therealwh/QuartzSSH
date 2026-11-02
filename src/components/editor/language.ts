// Pure mapping from a remote file path to an editor language kind.
// Deliberately free of any CodeMirror imports so it is cheap to test and can
// be reused (e.g. by the file pane) without pulling in the editor chunk.

export type EditorLanguageKind =
  | "javascript"
  | "jsx"
  | "typescript"
  | "tsx"
  | "json"
  | "python"
  | "yaml"
  | "shell"
  | "toml"
  | "ini"
  | "html"
  | "css"
  | "plain";

/** Dotfiles that are shell scripts despite having no useful extension. */
const SHELL_DOTFILES = new Set([
  ".bashrc",
  ".bash_profile",
  ".bash_login",
  ".bash_logout",
  ".profile",
  ".zshrc",
  ".zprofile",
  ".zshenv",
  ".zlogin",
]);

export function baseName(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

export function editorLanguageFor(path: string): EditorLanguageKind {
  const name = baseName(path).toLowerCase();
  if (SHELL_DOTFILES.has(name)) return "shell";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "plain"; // no extension at all
  switch (name.slice(dot + 1)) {
    case "js":
    case "mjs":
    case "cjs":
      return "javascript";
    case "jsx":
      return "jsx";
    case "ts":
    case "mts":
    case "cts":
      return "typescript";
    case "tsx":
      return "tsx";
    case "json":
      return "json";
    case "py":
      return "python";
    case "yaml":
    case "yml":
      return "yaml";
    case "sh":
    case "bash":
      return "shell";
    case "toml":
      return "toml";
    case "ini":
    case "conf":
    case "cfg":
      return "ini";
    case "html":
    case "htm":
      return "html";
    case "css":
      return "css";
    default:
      return "plain";
  }
}
