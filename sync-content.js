// Reads Sudipta's "Update my website" Google Form answers and writes content/updates.json (+ photos in images/u/).
// Run: node sync-content.js   (the GitHub Action runs it on a schedule, then node generate.js if anything changed)
// The answers sheet is shared "anyone with the link can view"; its CSV URL lives in content/source.json.
// Question titles below must match the form exactly (created by content/form-setup.gs; the two photo
// questions are added by hand in the form editor because Apps Script cannot create file-upload questions).
// Photos are resized with sharp when it is installed (the Action installs it); otherwise saved as they are.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DIR = path.join(__dirname, "content");
const OUT = path.join(DIR, "updates.json");
const CACHE = path.join(DIR, "link-cache.json"); // link previews fetched once, so a flaky site never flips the page
const IMG = path.join(__dirname, "images", "u");
const csvUrl = process.env.CSV_URL || JSON.parse(fs.readFileSync(path.join(DIR, "source.json"), "utf8")).csvUrl;
let sharp = null; try { sharp = require("sharp"); } catch {}

const Q = {
  what: "What do you want to update?",
  priceItem: "Which price?", price: "New price in ₹ (numbers only)",
  batchCourse: "Which course?", batch: "When does the next batch start?",
  tName: "Client's first name", tAge: "Their age (optional)", tCity: "Their city (optional)", tCourse: "Which course did they do?",
  tWords: "What did they say?", tVideo: "YouTube link of their video (optional)",
  vLink: "YouTube link", vWhere: "Where should it show?", vTitle: "Short title (optional)",
  aLink: "Article link", aTitle: "Article title (optional)", aNote: "A line about it (optional)", aPhoto: "Article photo (optional)",
  pLink: "Interview or press link", pLabel: "How should it read on the website? (optional)",
  eType: "What is it?", eTitle: "Name of the event", eDates: "Dates and time", eEnd: "Last day of the event", eWhere: "Where?",
  ePrice: "Price in ₹ (optional, numbers only)", eUnit: "Price note (optional)", eDesc: "Describe it in 1 to 3 sentences", ePhoto: "Event photo (optional)",
  rKind: "What should come off the website?", rKey: "Paste its link, or type its name or title exactly",
};
const PRICE_KEYS = {
  "LEAP": "leap", "Playsophy (early bird)": "playEarly", "Playsophy (regular)": "playRegular",
  "Group Classes: drop-in": "groupDrop", "Group Classes: 6 sessions": "group6", "Group Classes: 8 sessions": "group8",
  "Group Classes: 10 sessions": "group10", "Group Classes: 12 sessions": "group12",
  "Discovery Call": "discovery", "Consultation Call": "consultation",
};
const BATCH_KEYS = { "LEAP": "leap", "Playsophy": "playsophy", "Group Classes": "group" };
const PLACE_KEYS = { "Home page": "home", "About page": "about", "Courses page": "courses", "Group Classes page": "group", "Testimonials page": "testimonials" };
const KIND_KEYS = { "A bootcamp, retreat or workshop": "event", "An article I read": "article", "An interview or press link": "press", "A YouTube video": "video", "A testimonial": "testimonial" };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; };
const norm = (t) => String(t || "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[/#?]+$/, "").replace(/\s+/g, " ").trim();
const isUrl = (u) => /^https?:\/\/[^\s]+\.[^\s]+$/i.test(String(u || "").trim());
const decode = (t) => String(t || "").replace(/&#0*39;|&apos;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"')
  .replace(/&ndash;/g, "–").replace(/&mdash;/g, "—").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");
// "Sentence case" for SHOUTY titles only; normal titles are kept as written
const tidy = (t) => (t && t === t.toUpperCase() && /[A-Z]{4}/.test(t) ? t.charAt(0) + t.slice(1).toLowerCase() : t);

function ytParse(url) {
  const u = String(url || "").trim();
  const m = u.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/);
  if (!m) return null;
  const t = u.match(/[?&](?:t|start)=(\d+)/);
  return { id: m[1], short: /\/shorts\//.test(u), t: t ? +t[1] : 0 };
}

/* link previews (cached) */
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
async function getText(url) { const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en" }, redirect: "follow", signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); }
async function ytTitle(id) {
  const k = "yt:" + id; if (cache[k]) return cache[k];
  try { const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`); if (r.ok) return (cache[k] = tidy((await r.json()).title || "")); } catch {}
  return null;
}
async function preview(url) {
  if (cache[url]) return cache[url];
  const html = await getText(url);
  const meta = (names) => {
    for (const n of names) {
      const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']*)["']`, "i")) || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${n}["']`, "i"));
      if (m && m[1].trim()) return decode(m[1].trim());
    }
    return "";
  };
  const title = meta(["og:title", "twitter:title"]) || decode((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "").trim();
  const host = new URL(url).hostname.replace(/^www\./, "");
  const site = meta(["og:site_name", "application-name"]) || host;
  // drop " | Site name" tails from titles
  const t2 = title.split(/\s+[|·–—-]\s+/).filter((x) => x && norm(x) !== norm(site)).join(" - ") || title;
  return (cache[url] = { title: tidy(t2), site, d: meta(["og:description", "description", "twitter:description"]), image: meta(["og:image", "og:image:secure_url", "twitter:image", "twitter:image0"]), host });
}

/* photos: from the form's upload questions (Drive) or an article's banner; saved once as images/u/<hash>.jpg */
const used = new Set();
async function photo(src) {
  if (!src) return null;
  const drive = String(src).match(/[?&]id=([\w-]{20,})|\/d\/([\w-]{20,})/);
  const url = drive ? `https://drive.google.com/uc?export=download&id=${drive[1] || drive[2]}` : src;
  const name = crypto.createHash("sha1").update(url).digest("hex").slice(0, 12) + ".jpg";
  const fp = path.join(IMG, name);
  used.add(name);
  if (fs.existsSync(fp)) return "u/" + name;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(30000) });
    const type = r.headers.get("content-type") || "";
    if (!r.ok || !/^image\//.test(type)) throw new Error(`HTTP ${r.status} ${type}${drive ? " (is the Drive file shared?)" : ""}`);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.mkdirSync(IMG, { recursive: true });
    if (sharp) await sharp(buf).rotate().resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toFile(fp);
    else if (/jpe?g/.test(type)) fs.writeFileSync(fp, buf);
    else throw new Error("not a JPEG and sharp is not installed");
    return "u/" + name;
  } catch (e) { used.delete(name); problems.push(`photo ${src}: ${e.message}`); return null; }
}

// "Last day" from a date question: 15/02/2027 (sheet locale en_GB), 2027-02-15, or 2/15/2027 when the day is > 12
function isoDate(v) {
  v = String(v || "").trim(); let m;
  if ((m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  if ((m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) { let [d, mo] = [+m[1], +m[2]]; if (mo > 12) [d, mo] = [mo, d]; return `${m[3]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
  return "";
}

const problems = [];
(async () => {
  const res = await fetch(csvUrl, { redirect: "follow" });
  if (!res.ok) throw new Error(`Could not read the form sheet: HTTP ${res.status}`);
  const [head, ...rows] = parseCsv(await res.text());
  const col = (name) => head.findIndex((h) => h.trim() === name);
  const get = (r, name) => { const i = col(name); return i < 0 ? "" : (r[i] || "").trim(); };

  const out = { prices: {}, batches: {}, testimonials: [], videos: [], reads: [], press: [], events: [], removed: [] };
  const unremove = (kind, ...keys) => { out.removed = out.removed.filter((x) => !(x.kind === kind && keys.some((k) => k && norm(k) === norm(x.key)))); };

  for (const r of rows) { // oldest first, so a later answer wins
    if (!r.some((c) => c.trim())) continue;
    const what = get(r, Q.what), when = r[0];
    try {
      if (/price/i.test(what)) {
        const key = PRICE_KEYS[get(r, Q.priceItem)];
        const n = parseInt(get(r, Q.price).replace(/[^\d]/g, ""), 10);
        if (key && n >= 100 && n <= 10000000) out.prices[key] = n; else problems.push(`${when}: price "${get(r, Q.price)}" for "${get(r, Q.priceItem)}" ignored`);
      } else if (/batch/i.test(what)) {
        const key = BATCH_KEYS[get(r, Q.batchCourse)], v = get(r, Q.batch);
        if (!key) continue;
        if (!v || /^(none|no|-|remove|delete)$/i.test(v)) delete out.batches[key]; else out.batches[key] = clip(v, 60);
      } else if (/testimonial/i.test(what)) {
        const who = clip(get(r, Q.tName), 40), words = clip(get(r, Q.tWords), 1200);
        if (!who || !words) { problems.push(`${when}: testimonial without a name or words ignored`); continue; }
        unremove("testimonial", who);
        out.testimonials = out.testimonials.filter((t) => norm(t.who) !== norm(who));
        out.testimonials.unshift({ who, age: clip(get(r, Q.tAge), 10), city: clip(get(r, Q.tCity), 40), course: get(r, Q.tCourse), words, video: ytParse(get(r, Q.tVideo)) });
      } else if (/video/i.test(what)) {
        const v = ytParse(get(r, Q.vLink));
        if (!v) { problems.push(`${when}: "${get(r, Q.vLink)}" is not a YouTube link`); continue; }
        const places = get(r, Q.vWhere).split(/,\s*/).map((p) => PLACE_KEYS[p]).filter(Boolean);
        const title = clip(get(r, Q.vTitle) || (await ytTitle(v.id)) || "Watch on YouTube", 70);
        unremove("video", v.id);
        out.videos = out.videos.filter((x) => x.id !== v.id);
        out.videos.unshift({ ...v, title, places: places.length ? places : ["home"] });
      } else if (/article/i.test(what)) {
        const url = get(r, Q.aLink);
        if (!isUrl(url)) { problems.push(`${when}: "${url}" is not a link`); continue; }
        let pv = {}; try { pv = await preview(url); } catch (e) { problems.push(`${when}: could not read ${url} (${e.message}), using the form text only`); }
        const title = clip(get(r, Q.aTitle) || pv.title || pv.host || "Read the article", 90);
        const img = (await photo(get(r, Q.aPhoto).split(/,\s*/)[0])) || (await photo(pv.image));
        unremove("article", url, title);
        out.reads = out.reads.filter((x) => norm(x.url) !== norm(url));
        out.reads.unshift({ url, title, src: clip(pv.site || new URL(url).hostname.replace(/^www\./, ""), 40), d: clip(get(r, Q.aNote) || pv.d, 170), img: img || "leap-tree-smile.jpg" });
      } else if (/interview|press/i.test(what)) {
        const url = get(r, Q.pLink);
        if (!isUrl(url)) { problems.push(`${when}: "${url}" is not a link`); continue; }
        let label = get(r, Q.pLabel);
        if (!label) { try { const pv = await preview(url); label = `${pv.site}: ${pv.title}`; } catch (e) { label = new URL(url).hostname.replace(/^www\./, ""); problems.push(`${when}: could not read ${url} (${e.message})`); } }
        label = clip(label, 110);
        unremove("press", url, label);
        out.press = out.press.filter((x) => norm(x.url) !== norm(url));
        out.press.unshift({ url, label });
      } else if (/bootcamp|retreat|workshop|event/i.test(what)) {
        const title = clip(get(r, Q.eTitle), 60), d = clip(get(r, Q.eDesc), 320);
        if (!title || !d) { problems.push(`${when}: event without a name or description ignored`); continue; }
        const price = parseInt(get(r, Q.ePrice).replace(/[^\d]/g, ""), 10);
        const img = await photo(get(r, Q.ePhoto).split(/,\s*/)[0]);
        unremove("event", title);
        out.events = out.events.filter((x) => norm(x.title) !== norm(title));
        out.events.push({ type: get(r, Q.eType) || "Workshop", title, dates: clip(get(r, Q.eDates), 60), end: isoDate(get(r, Q.eEnd)), where: clip(get(r, Q.eWhere), 50),
          price: price >= 1 ? price : null, unit: clip(get(r, Q.eUnit), 40), d, img });
      } else if (/remove/i.test(what)) {
        const kind = KIND_KEYS[get(r, Q.rKind)], raw = get(r, Q.rKey);
        if (!kind || !raw) { problems.push(`${when}: removal without a type or link ignored`); continue; }
        const yt = ytParse(raw), key = kind === "video" && yt ? yt.id : raw;
        const hit = (...ks) => ks.some((k) => k && norm(k) === norm(key));
        out.events = out.events.filter((x) => !(kind === "event" && hit(x.title)));
        out.reads = out.reads.filter((x) => !(kind === "article" && hit(x.url, x.title)));
        out.press = out.press.filter((x) => !(kind === "press" && hit(x.url, x.label)));
        out.videos = out.videos.filter((x) => !(kind === "video" && hit(x.id)));
        out.testimonials = out.testimonials.filter((x) => !(kind === "testimonial" && hit(x.who)));
        if (!out.removed.some((x) => x.kind === kind && norm(x.key) === norm(key))) out.removed.push({ kind, key }); // also hides built-in items
      }
    } catch (e) { problems.push(`${when}: ${e.message}`); }
  }
  // tidy: photos no longer used by any item are deleted
  if (fs.existsSync(IMG)) for (const f of fs.readdirSync(IMG)) if (!used.has(f)) fs.unlinkSync(path.join(IMG, f));

  fs.mkdirSync(DIR, { recursive: true });
  const json = JSON.stringify(out, null, 2) + "\n";
  const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (json !== old) { fs.writeFileSync(OUT, json); console.log("content/updates.json updated"); } else console.log("No changes");
  fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1) + "\n");
  console.log(`${rows.length} form answers: ${Object.keys(out.prices).length} prices, ${Object.keys(out.batches).length} batch dates, ${out.testimonials.length} testimonials, ${out.videos.length} videos, ${out.reads.length} articles, ${out.press.length} press links, ${out.events.length} events, ${out.removed.length} removals`);
  problems.forEach((p) => console.log("SKIPPED", p));
})().catch((e) => { console.error(e.message); process.exit(1); });
