#!/usr/bin/env node
import { execFileSync, execSync } from "child_process";
import fs from "fs";
import https from "https";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import zlib from "zlib";

const D = path.dirname(fileURLToPath(import.meta.url));
const V = "1.3.14";
const E = "index.js";
const T = 121_000;

const mu = () => {
  try {
    const o = execFileSync("ldd", ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    }).toString();
    if (o.includes("musl")) return true;
  } catch {}
  try {
    return fs.readFileSync("/etc/os-release", "utf8").includes("Alpine");
  } catch {
    return false;
  }
};

const PM = {
  "linux-arm64": () => "bun-linux-aarch64",
  "linux-x64": () =>
    mu() ? "bun-linux-x64-musl-baseline" : "bun-linux-x64-baseline",
  "darwin-arm64": () => "bun-darwin-aarch64",
  "darwin-x64": () => "bun-darwin-x64",
  "win32-arm64": () => "bun-windows-aarch64",
  "win32-x64": () => "bun-windows-x64-baseline",
};

function ra() {
  const k = `${process.platform}-${process.arch}`;
  const r = PM[k];
  if (!r) throw new Error(`Unsupported platform/arch: ${k}`);
  return r();
}

function dl(u, d, n = 5) {
  return new Promise((ok, no) => {
    const q = https.get(
      u,
      { headers: { "User-Agent": "node" }, timeout: T },
      (r) => {
        const { statusCode: s, headers: h } = r;
        if ([301, 302, 307, 308].includes(s)) {
          r.resume();
          if (n <= 0) return no(new Error("Too many redirects"));
          return dl(h.location, d, n - 1).then(ok, no);
        }
        if (s !== 200) {
          r.resume();
          return no(new Error(`HTTP ${s} for ${u}`));
        }
        const f = fs.createWriteStream(d);
        r.pipe(f);
        f.on("finish", () => f.close(ok));
        f.on("error", (e) => {
          fs.unlink(d, () => no(e));
        });
      },
    );
    q.on("error", no);
    q.on("timeout", () => q.destroy(new Error("Request timed out")));
  });
}

function hc(c, a = ["--version"]) {
  try {
    execFileSync(c, a, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function xz(zp, en, od) {
  // Use OS tools: unzip or powershell. Fall back to npm install bun.
  if (process.platform === "win32" && hc("powershell", ["-Help"])) {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `Expand-Archive -LiteralPath '${zp}' -DestinationPath '${od}' -Force`,
      ],
      { stdio: "inherit" },
    );
    const np = path.join(od, en);
    const fp = path.join(od, path.basename(en));
    fs.renameSync(np, fp);
    return;
  }

  if (hc("unzip", ["-v"])) {
    execFileSync("unzip", ["-ojq", zp, en, "-d", od], { stdio: "inherit" });
    return;
  }

  installBunViaNpm(td);
}

function installBunViaNpm(td) {
  try {
    execSync("npm install bun", { stdio: "inherit", cwd: td });
  } catch {
    // npm install failed, fall back to JS-based extraction
    xn(zp, en, od);
  }
}

function xn(zp, en, od) {
  const b = fs.readFileSync(zp);
  let eo = -1;
  for (let i = b.length - 22; i >= 0 && i >= b.length - 65557; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      eo = i;
      break;
    }
  }
  if (eo === -1) throw new Error("Invalid ZIP: EOCD record not found");
  const ce = b.readUInt16LE(eo + 10);
  const co = b.readUInt32LE(eo + 16);
  let o = co;
  let lo = -1;
  let cm = -1;
  let cs = 0;
  for (let i = 0; i < ce; i++) {
    if (b.readUInt32LE(o) !== 0x02014b50)
      throw new Error("Invalid ZIP: bad CD entry signature");
    const m = b.readUInt16LE(o + 10);
    const sz = b.readUInt32LE(o + 20);
    const fl = b.readUInt16LE(o + 28);
    const el = b.readUInt16LE(o + 30);
    const cl = b.readUInt16LE(o + 32);
    const lh = b.readUInt32LE(o + 42);
    const nm = b.subarray(o + 46, o + 46 + fl).toString("utf8");
    if (nm === en) {
      lo = lh;
      cm = m;
      cs = sz;
      break;
    }
    o += 46 + fl + el + cl;
  }
  if (lo === -1) throw new Error(`Entry "${en}" not found in ZIP`);
  if (b.readUInt32LE(lo) !== 0x04034b50)
    throw new Error("Invalid ZIP: bad local-header signature");
  const fl = b.readUInt16LE(lo + 26);
  const el = b.readUInt16LE(lo + 28);
  const dp = lo + 30 + fl + el;
  const rw = b.subarray(dp, dp + cs);
  let fd;
  if (cm === 0) {
    fd = rw;
  } else if (cm === 8) {
    fd = zlib.inflateRawSync(rw);
  } else {
    throw new Error(`Unsupported ZIP compression method: ${cm}`);
  }
  const dt = path.join(od, path.basename(en));
  fs.writeFileSync(dt, fd);
}

async function main() {
  if (hc("bun")) return;

  const a = ra();
  const w = process.platform === "win32";
  const bn = w ? "bun.exe" : "bun";
  const u = `https://github.com/oven-sh/bun/releases/download/bun-v${V}/${a}.zip`;

  const td = fs.mkdtempSync(path.join(os.tmpdir(), "bun-dl-"));
  const zp = path.join(td, `${a}.zip`);
  const bp = path.join(td, bn);
  const ep = path.join(D, E);

  try {
    await dl(u, zp);
    xz(zp, `${a}/${bn}`, td);
    fs.unlinkSync(zp);
    if (!w) fs.chmodSync(bp, 0o755);
    execFileSync(bp, [ep], { stdio: "inherit", cwd: D });
  } finally {
    fs.rmSync(td, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
