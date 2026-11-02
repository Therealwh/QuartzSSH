// Render the chosen logo to PNG and generate all platform icons via tauri icon.
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs", "logo", "preview");
mkdirSync(outDir, { recursive: true });

const variants = ["quartzssh-main", "quartzssh-brackets", "quartzssh-monogram"];
for (const name of variants) {
  const svg = join(root, "docs", "logo", `${name}.svg`);
  await sharp(svg, { density: 96 })
    .resize(512, 512)
    .png()
    .toFile(join(outDir, `${name}.png`));
  console.log("rendered", name);
}

// The main variant becomes the application icon.
const chosen = join(root, "docs", "logo", "quartzssh-main.svg");
const iconSource = join(outDir, "icon-source.png");
await sharp(chosen, { density: 96 }).resize(1024, 1024).png().toFile(iconSource);

execSync(`npx tauri icon "${iconSource}"`, { cwd: root, stdio: "inherit" });
console.log("icons generated");
