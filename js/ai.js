// ---------- API key storage ----------
const API_KEY_STORAGE = "beyondverse_groq_key";

function getApiKey() {
  try { return localStorage.getItem(API_KEY_STORAGE) || ""; }
  catch (e) { return ""; }
}

function setApiKey(key) {
  try {
    if (key) localStorage.setItem(API_KEY_STORAGE, key);
    else localStorage.removeItem(API_KEY_STORAGE);
  } catch (e) { console.warn("Could not persist API key", e); }
}

function hasApiKey() {
  return !!getApiKey();
}

// ---------- Seen-title memory (to reduce repeats across visits) ----------
const SEEN_STORAGE_PREFIX = "beyondverse_seen_";
const SEEN_CAP = 60;

function getSeenTitles(section) {
  try {
    const raw = localStorage.getItem(SEEN_STORAGE_PREFIX + section);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function addSeenTitles(section, titles) {
  try {
    const current = getSeenTitles(section);
    const merged = [...current, ...titles];
    const trimmed = merged.slice(Math.max(0, merged.length - SEEN_CAP));
    localStorage.setItem(SEEN_STORAGE_PREFIX + section, JSON.stringify(trimmed));
  } catch (e) { /* ignore */ }
}

// ---------- Core Groq call ----------
async function groqChat(systemPrompt, userPrompt, { temperature = 0.85, maxTokens = 1400, jsonMode = false } = {}) {
  const key = getApiKey();
  if (!key) throw new Error("No API key set");

  const body = {
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature,
    max_tokens: maxTokens
  };
  if (jsonMode) body.response_format = { type: "json_object" };

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    if (res.status === 401) throw new Error("Invalid API key");
    throw new Error(`API error ${res.status}${errText ? ": " + errText.slice(0, 140) : ""}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Empty response from AI");
  return content;
}

function parseJsonLoose(text) {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const candidates = ["{", "["].map((c) => cleaned.indexOf(c)).filter((i) => i !== -1);
  if (candidates.length) {
    const start = Math.min(...candidates);
    if (start > 0) cleaned = cleaned.slice(start);
  }
  cleaned = cleaned.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const repaired2 = cleaned.replace(/([a-zA-Z,])"([a-zA-Z])/g, '$1\\"$2');
    try {
      return JSON.parse(repaired2);
    } catch (e2) {
      throw e;
    }
  }
}

async function generateJson(systemPrompt, userPrompt, opts = {}) {
  const callOpts = { ...opts, jsonMode: true };
  try {
    const raw = await groqChat(systemPrompt, userPrompt, callOpts);
    return parseJsonLoose(raw);
  } catch (firstErr) {
    const retryPrompt = userPrompt + `

Your previous attempt failed (${firstErr.message}). Try again with a simpler structure: keep every string value plain text with no nested quotation marks, no line breaks inside strings, and no double-quote characters inside any string value.`;
    const raw2 = await groqChat(systemPrompt, retryPrompt, callOpts);
    return parseJsonLoose(raw2);
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
}

// ---------- Section-specific prompt builders ----------
const SECTION_PROMPTS = {
  ot: {
    system: `You are a Bible content generator for an app called "Beyond the Verse" that explores Old Testament stories and happenings, not standard chapter-by-chapter reading. You write in an engaging, human, narrative-nonfiction style, similar to a well-researched storyteller. Be historically and textually grounded; note real scholarly or interpretive disputes briefly where relevant rather than presenting one view as settled. Never fabricate a chapter/verse reference. Formatting rule: inside any JSON string value, use single quotes (') for dialogue or quoted speech, never double quotes — a double quote inside a string breaks JSON parsing.`,
    batchInstruction: (n, exclude) => `Generate ${n} distinct Old Testament stories or happenings (can be well-known or more obscure) suitable for a "story teaser" list. Avoid these already-shown titles: ${exclude.length ? exclude.join("; ") : "none"}.
Respond as a JSON object with a single key "items", whose value is an array of exactly ${n} objects, no markdown fences. Each object has keys: "title" (string), "reference" (real book/chapter, e.g. "Genesis 6-9"), "era" (short phrase like "The Patriarchs" or "The Judges"), "summary" (one engaging sentence, under 25 words).`,
  detailInstruction: (item) => `Write the full profile for the Bible character "${item.name}" (${item.title}, ${item.reference}). Respond ONLY with a JSON object, no markdown fences, with keys:
"bio": a 3-5 sentence biography covering who they were and what they're known for,
"qualities": an array of 4 short phrases describing their personality/character traits (can include flaws, not just virtues),
"quotes": an array of 1-2 objects, each with keys "text" (the quote itself, plain text, no quotation marks around it) and "reference" (e.g. "John 3:16"),
"keyMoments": an array of 1-2 short phrases naming pivotal moments in their story (plain text, not links).`
  },
  nt: {
    system: `You are a Bible content generator for an app called "Beyond the Verse" that explores New Testament stories and happenings, not standard chapter-by-chapter reading. You write in an engaging, human, narrative-nonfiction style. Be textually grounded; note real scholarly or interpretive disputes briefly where relevant. Never fabricate a chapter/verse reference. Formatting rule: inside any JSON string value, use single quotes (') for dialogue or quoted speech, never double quotes — a double quote inside a string breaks JSON parsing.`,
    batchInstruction: (n, exclude) => `Generate ${n} distinct New Testament stories or happenings (Gospels, Acts, or notable events referenced in the Epistles) suitable for a "story teaser" list. Avoid these already-shown titles: ${exclude.length ? exclude.join("; ") : "none"}.
Respond as a JSON object with a single key "items", whose value is an array of exactly ${n} objects, no markdown fences. Each object has keys: "title" (string), "reference" (real book/chapter), "era" (short phrase like "The Gospels" or "The Early Church"), "summary" (one engaging sentence, under 25 words).`,
    detailInstruction: (item) => `Write the full entry for the New Testament story titled "${item.title}" (${item.reference}). Respond ONLY with a JSON object, no markdown fences, with keys:
"content": an array of 3 paragraphs (each 80-160 words) telling the story in an engaging narrative-nonfiction style,
"tags": an array of 3 short lowercase theme tags (1-2 words each).`
  },
  characters: {
    system: `You are a Bible content generator for an app called "Beyond the Verse" that profiles Bible characters with real depth, not just a name and a title. You write in an engaging, human style. Be textually grounded; note real scholarly or interpretive disputes briefly where relevant. Never fabricate a chapter/verse reference or quote. Formatting rule: inside any JSON string value, use single quotes (') for dialogue or quoted speech, never double quotes — a double quote inside a string breaks JSON parsing.`,
    batchInstruction: (n, exclude) => `Generate ${n} distinct Bible characters (Old or New Testament, well-known or more obscure) suitable for a profile list. Avoid these already-shown names: ${exclude.length ? exclude.join("; ") : "none"}.
Respond as a JSON object with a single key "items", whose value is an array of exactly ${n} objects, no markdown fences. Each object has keys: "name" (string), "title" (a short evocative epithet, e.g. "The Shepherd King"), "reference" (real book range), "era" (short phrase), "bio" (one teaser sentence, under 25 words).`,
    detailInstruction: (item) => `Write the full profile for the Bible character "${item.name}" (${item.title}, ${item.reference}). Respond ONLY with a JSON object, no markdown fences, with keys:
"bio": a 3-5 sentence biography covering who they were and what they're known for,
"qualities": an array of 4 short phrases describing their personality/character traits (can include flaws, not just virtues),
"quotes": an array of 1-2 real or closely-paraphrased quotes attributed to them with a reference in parentheses, formatted like "\\"quote text\\" (Book 1:1)",
"keyMoments": an array of 1-2 short phrases naming pivotal moments in their story (plain text, not links).`
  },
  backstories: {
    system: `You are a Bible content generator for an app called "Beyond the Verse" that surfaces lesser-known, strange, or debated backstories and details from the Bible, the kind of thing most readers skim past. You write in an engaging, curious, human style. Be textually grounded; note real scholarly or interpretive disputes briefly where relevant. Never fabricate a chapter/verse reference. Formatting rule: inside any JSON string value, use single quotes (') for dialogue or quoted speech, never double quotes — a double quote inside a string breaks JSON parsing.`,
    batchInstruction: (n, exclude) => `Generate ${n} distinct "interesting backstory" entries: strange, obscure, or debated details, objects, side-characters, or passages in the Bible that reward a closer look. Avoid these already-shown titles: ${exclude.length ? exclude.join("; ") : "none"}.
Respond as a JSON object with a single key "items", whose value is an array of exactly ${n} objects, no markdown fences. Each object has keys: "title" (string), "reference" (real book/chapter), "hook" (one intriguing teaser sentence, under 25 words, framed as why this is worth reading).`,
    detailInstruction: (item) => `Write the full entry for the backstory titled "${item.title}" (${item.reference}). Respond ONLY with a JSON object, no markdown fences, with keys:
"content": an array of 3 paragraphs (each 80-160 words) explaining the backstory in an engaging, curious style, including any real scholarly debate about it.`
  }
};

// ---------- Public: generate a batch of teaser items for a section ----------
async function generateBatch(section, count = 8) {
  const cfg = SECTION_PROMPTS[section];
  const exclude = getSeenTitles(section);
  const userPrompt = cfg.batchInstruction(count, exclude);
  const parsed = await generateJson(cfg.system, userPrompt, { temperature: 0.95, maxTokens: 900 });
  const list = Array.isArray(parsed) ? parsed : parsed.items;
  if (!Array.isArray(list)) throw new Error("Unexpected batch format");

  const items = list.map((obj) => {
    const label = obj.title || obj.name;
    return { ...obj, id: slugify(label) + "-" + Math.random().toString(36).slice(2, 7) };
  });

  addSeenTitles(section, items.map((i) => i.title || i.name));
  return items;
}

// ---------- Public: generate full detail content for a teaser item ----------
async function generateDetail(section, teaser) {
  const cfg = SECTION_PROMPTS[section];
  const userPrompt = cfg.detailInstruction(teaser);
  const parsed = await generateJson(cfg.system, userPrompt, { temperature: 0.8, maxTokens: 1200 });
  return { ...teaser, ...parsed };
}

// ---------- Public: follow-up Q&A on a generated entry ----------
async function askAboutEntry(item, section, question) {
  const label = item.title || item.name;
  const contextParts = [];
  if (item.reference) contextParts.push(`Reference: ${item.reference}`);
  if (item.era) contextParts.push(`Era: ${item.era}`);
  if (item.summary) contextParts.push(`Summary: ${item.summary}`);
  if (item.hook) contextParts.push(`Hook: ${item.hook}`);
  if (item.bio) contextParts.push(`Bio: ${item.bio}`);
  if (item.content) contextParts.push(`Full account: ${item.content.join(" ")}`);
  if (item.qualities) contextParts.push(`Qualities: ${item.qualities.join(", ")}`);
  if (item.quotes) contextParts.push(`Quotes: ${item.quotes.join(" | ")}`);

  const systemPrompt = `You are a knowledgeable, warm Bible study companion inside an app called "Beyond the Verse". The user is reading about "${label}". Answer their follow-up question using the context below plus your general knowledge of the Bible. Keep answers conversational, concise (under 150 words unless asked for more), and grounded in the text. If something is disputed among scholars or traditions, say so briefly rather than presenting one view as settled fact. Do not invent chapter/verse references you are not confident about.

Context on ${label}:
${contextParts.join("\n")}`;

  return groqChat(systemPrompt, question, { temperature: 0.6, maxTokens: 400 });
}
