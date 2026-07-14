const REPO = "ajlee2006/bad_url_shortener_data";
const FILE = "data.json";
const BRANCH = "main";

export async function onRequestPost({ request, env }) {
  // 1. Parse + validate
  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad JSON" }, 400); }

  // 2. Verify Turnstile
  const token = body.turnstileToken;
  if (!token) return json({ error: "Missing Turnstile token" }, 400);
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const verify = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      secret: env.BAD_URL_SHORTENER_TURNSTILE_SECRET,
      response: token,
      remoteip: ip,
    }),
  });
  const verifyData = await verify.json();
  if (!verifyData.success) return json({ error: "Turnstile check failed" }, 403);

  // 3. Validate URL
  const url = normalizeUrl(body.url);
  if (!url) return json({ error: "Invalid URL" }, 400);

  // 4. Fetch current list, append, write back (retry on race)
  for (let attempt = 0; attempt < 3; attempt++) {
    const meta = await gh(`/repos/${REPO}/contents/${FILE}?ref=${BRANCH}`, env);
    if (!meta.ok) {
      const errText = await meta.text();
      return json({ error: `Can't read list: ${meta.status} ${errText}` }, 500);
    }
    const info = await meta.json();
    const list = JSON.parse(atob(info.content.replace(/\n/g, "")));

    // Dedup
    const existing = list.findIndex(e => e && e.url === url);
    if (existing !== -1) return json({ id: existing });

    // Append
    const newList = [...list, { url, added: new Date().toISOString().slice(0, 10) }];
    const newId = newList.length - 1;
    const encoded = btoa(JSON.stringify(newList, null, 2));

    const put = await gh(`/repos/${REPO}/contents/${FILE}`, env, {
      method: "PUT",
      body: JSON.stringify({
        message: `Add ${url}`,
        content: encoded,
        sha: info.sha,
        branch: BRANCH,
      }),
    });

    if (put.ok) return json({ id: newId });
    if (put.status === 409) continue; // race, retry
    return json({ error: `GitHub write failed (${put.status})` }, 500);
  }
  return json({ error: "Write conflict — try again" }, 503);
}

function normalizeUrl(s) {
  if (typeof s !== "string" || s.length > 2000) return null;
  try {
    if (!/^https?:\/\//i.test(s)) s = "https://" + s;
    const u = new URL(s);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    return u.toString();
  } catch { return null; }
}

function gh(path, env, opts = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      "Authorization": `Bearer ${env.BAD_URL_SHORTENER_GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "bad-url-shortener",
      ...(opts.headers || {}),
    },
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
