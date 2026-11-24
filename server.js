const express = require("express");
const path = require("path");
const dns = require("dns").promises;
const net = require("net");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

const saved = [
  {
    url: "https://example.edu/robotics",
    title: "Robotics club",
    snippet: "Shop hours, ride board, and the missing hex-driver thread."
  },
  {
    url: "https://example.edu/film",
    title: "Film society",
    snippet: "Thursday screening in the basement theater. Bring a chair."
  }
];

function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const v = ip.toLowerCase();
  return v === "::" || v === "::1" || v.startsWith("::ffff:") || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

async function safeFetch(url) {
  for (let i = 0; i < 4; i++) {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("blocked");
    const addrs = await dns.lookup(u.hostname.replace(/^\[|\]$/g, ""), { all: true });
    if (addrs.some((a) => isPrivate(a.address))) throw new Error("blocked");
    const r = await fetch(u, { redirect: "manual" });
    const next = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && next) {
      url = new URL(next, u).href;
      continue;
    }
    return r;
  }
  throw new Error("too many redirects");
}

function extract(html) {
  const title = (html.match(/<title>([^<]*)<\/title>/i) || [, ""])[1].trim();
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return {
    title: title || text.slice(0, 60) || "Untitled",
    snippet: text.slice(0, 240)
  };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/internal", (req, res) => {
  if (req.headers["x-forwarded-for"]) return res.status(404).send("Not found");
  res.type("text/plain").send(
    "Desk note. Not for the public preview list. Release code PREVIEW-4418. Rotate after the spring screening."
  );
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/preview", async (req, res) => {
  const url = String(req.body.url || "").trim();
  if (!url) {
    return res.status(400).send(page("Paste a URL.", saved, null));
  }
  try {
    const response = await safeFetch(url);
    const body = await response.text();
    const card = { url, ...extract(body), status: response.status };
    res.send(page(null, saved, card));
  } catch (err) {
    res.status(502).send(page("Could not fetch that URL.", saved, null));
  }
});

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(error, cards, fresh) {
  const list = cards
    .map(
      (card) => `<article class="card"><h2>${escapeHtml(card.title)}</h2><p>${escapeHtml(card.snippet)}</p><p class="url">${escapeHtml(card.url)}</p></article>`
    )
    .join("");
  const result = fresh
    ? `<article class="card fresh"><p class="status">${fresh.status}</p><h2>${escapeHtml(fresh.title)}</h2><p>${escapeHtml(fresh.snippet)}</p><p class="url">${escapeHtml(fresh.url)}</p></article>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Preview</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div class="shell">
    <header class="top">
      <a class="brand" href="/"><span class="mark">Pv</span><span><strong>Preview</strong><em>Club link cards</em></span></a>
    </header>
    <main>
      <section class="hero">
        <h1>Paste a club URL. Get a card.</h1>
        <p class="lede">Preview fetches the page and keeps the title and the first lines. No account required.</p>
      </section>
      <form method="post" action="/preview" class="stack">
        <label><span>URL</span><input name="url" type="url" placeholder="https://..." required></label>
        <button type="submit">Preview</button>
      </form>
      ${error ? `<p class="flash">${escapeHtml(error)}</p>` : ""}
      ${result}
      <h2 class="section">Saved cards</h2>
      ${list}
    </main>
    <footer>Preview is unofficial. It only reads what the URL returns.</footer>
  </div>
</body>
</html>`;
}

const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => {
  console.log(`Preview listening on ${port}`);
});
