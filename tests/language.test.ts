import { describe, expect, it } from "vitest";
import { baseName, editorLanguageFor } from "../src/components/editor/language";

describe("editorLanguageFor", () => {
  it("maps common extensions to languages", () => {
    expect(editorLanguageFor("/srv/app/main.js")).toBe("javascript");
    expect(editorLanguageFor("/srv/app/main.mjs")).toBe("javascript");
    expect(editorLanguageFor("/srv/app/app.ts")).toBe("typescript");
    expect(editorLanguageFor("/srv/app/component.jsx")).toBe("jsx");
    expect(editorLanguageFor("/srv/app/component.tsx")).toBe("tsx");
    expect(editorLanguageFor("/srv/app/pkg.json")).toBe("json");
    expect(editorLanguageFor("/srv/app/script.py")).toBe("python");
    expect(editorLanguageFor("/srv/app/docker-compose.yml")).toBe("yaml");
    expect(editorLanguageFor("/srv/app/config.yaml")).toBe("yaml");
    expect(editorLanguageFor("/srv/app/run.sh")).toBe("shell");
    expect(editorLanguageFor("/srv/app/run.bash")).toBe("shell");
    expect(editorLanguageFor("/srv/app/Cargo.toml")).toBe("toml");
    expect(editorLanguageFor("/etc/app/app.conf")).toBe("ini");
    expect(editorLanguageFor("/etc/app/app.cfg")).toBe("ini");
    expect(editorLanguageFor("/var/www/index.html")).toBe("html");
    expect(editorLanguageFor("/var/www/style.css")).toBe("css");
  });

  it("recognizes shell dotfiles without an extension", () => {
    expect(editorLanguageFor("/home/user/.bashrc")).toBe("shell");
    expect(editorLanguageFor("/home/user/.bash_profile")).toBe("shell");
    expect(editorLanguageFor("/home/user/.zshrc")).toBe("shell");
  });

  it("falls back to plain text", () => {
    expect(editorLanguageFor("/srv/README")).toBe("plain");
    expect(editorLanguageFor("/srv/data/blob.xyz")).toBe("plain");
    expect(editorLanguageFor("/srv/data/.env")).toBe("plain");
    expect(editorLanguageFor("")).toBe("plain");
  });

  it("is case-insensitive on extensions", () => {
    expect(editorLanguageFor("/srv/APP.JSON")).toBe("json");
    expect(editorLanguageFor("/srv/App.Ts")).toBe("typescript");
  });

  it("takes the last path segment, not the directories", () => {
    expect(baseName("/etc/nginx/conf.d/default.conf")).toBe("default.conf");
    expect(editorLanguageFor("/etc/nginx/conf.d/default.conf")).toBe("ini");
    expect(editorLanguageFor("/home/user/py.d/main.py")).toBe("python");
  });
});
