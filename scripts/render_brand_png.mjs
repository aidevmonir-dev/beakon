import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const brand = resolve("docs/brand");
const out = resolve("docs/brand/png");

const jobs = [
  { src: "beakon-icon.svg",       name: "beakon-icon",       widths: [256, 512, 1024] },
  { src: "beakon-horizontal.svg", name: "beakon-horizontal", widths: [1200] },
  { src: "beakon-stacked.svg",    name: "beakon-stacked",    widths: [1200] },
];

for (const job of jobs) {
  const svg = await readFile(resolve(brand, job.src));
  for (const w of job.widths) {
    const file = resolve(out, `${job.name}-${w}.png`);
    await sharp(svg, { density: 384 })
      .resize({ width: w })
      .png()
      .toFile(file);
    console.log("wrote", file);
  }
}
