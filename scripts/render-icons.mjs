import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(here, "..", "src", "icons");
const srcSvg = join(iconsDir, "icon.svg");
const sizes = [16, 32, 48, 64, 96, 128];

const svg = await readFile(srcSvg);

for (const size of sizes) {
  const out = join(iconsDir, `icon-${size}.png`);
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(out);
  console.log("wrote", out);
}

console.log("done");
