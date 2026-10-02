// ============================================
// npm --prefix tools install   (တစ်ကြိမ်)
// node tools/build.js          (deploy မတင်ခင် အမြဲ run)
//   1) Tailwind static CSS ထုတ် (css/tailwind.css)  — CDN runtime compile မလိုတော့ဘူး
//   2) sw.js ထဲ precache list + version ကို auto ထည့် (CACHE_NAME ကို လက်နဲ့ v8->v9 မတိုးရတော့ဘူး)
// ============================================
const fs = require("fs"), path = require("path"), crypto = require("crypto"), cp = require("child_process");
const root = path.join(__dirname, "..");

// 1) Tailwind
const localBin = path.join(__dirname, "node_modules", ".bin", "tailwindcss");
const bin = fs.existsSync(localBin) ? `"${localBin}"` : "npx --yes tailwindcss@3.4.17";
try {
  cp.execSync(`${bin} -c tailwind.config.js -i css/src/tailwind.input.css -o css/tailwind.css --minify`, { cwd: root, stdio: "inherit" });
} catch (e) { console.warn("! tailwind build skipped:", e.message); }

// 2) Precache list
const exts = /\.(html|css|js|json|png|jpg|jpeg|svg|webp|ico)$/i;
function walk(dir, out = []) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return out;
  for (const f of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.posix.join(dir, f.name);
    if (f.isDirectory()) walk(rel, out);
    else if (exts.test(f.name)) out.push(rel);
  }
  return out;
}
let files = ["index.html", ...walk("css").filter((f) => !f.startsWith("css/src/")), ...walk("js"), ...walk("views"), ...walk("public")];
files = [...new Set(files)].sort();

const hash = crypto.createHash("sha1");
files.forEach((f) => hash.update(f).update(fs.readFileSync(path.join(root, f))));
const version = hash.digest("hex").slice(0, 8);

const swPath = path.join(root, "sw.js");
let sw = fs.readFileSync(swPath, "utf8");
sw = sw.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`);
sw = sw.replace(/\/\*PRECACHE_START\*\/[\s\S]*?\/\*PRECACHE_END\*\//, `/*PRECACHE_START*/\n${JSON.stringify(["./", ...files.map((f) => "./" + f)], null, 2)}\n/*PRECACHE_END*/`);
fs.writeFileSync(swPath, sw);
console.log(`sw.js stamped: v${version}, ${files.length} files precached`);
