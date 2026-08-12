// ---------- API key storage ----------
const API_KEY_STORAGE = "beyondverse_groq_key";

function getApiKey() {
  try {
    return localStorage.getItem(API_KEY_STORAGE) || "";
  } catch (e) {
    return "";
  }
}

function setApiKey(key) {
  try {
    if (key) localStorage.setItem(API_KEY_STORAGE, key);
    else localStorage.removeItem(API_KEY_STORAGE);
  } catch (e) {
    console.warn("Could not persist API key", e);
  }
}

function hasApiKey() {
  return !!getApiKey();
}


// ---------- Seen-title memory ----------
const SEEN_STORAGE_PREFIX = "beyondverse_seen_";
const SEEN_CAP = 60;

function getSeenTitles(section) {
  try {
    const raw = localStorage.getItem(SEEN_STORAGE_PREFIX + section);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function addSeenTitles(section, titles) {
  try {
    const current = getSeenTitles(section);
    const merged = [...current, ...titles];
    const trimmed = merged.slice(
      Math.max(0, merged.length - SEEN_CAP)
    );

    localStorage.setItem(
      SEEN_STORAGE_PREFIX + section,
      JSON.stringify(trimmed)
    );
  } catch (e) {
    // Ignore storage errors.
  }
}


// ---------- Core Groq call ----------
async function groqChat(
  systemPrompt,
  userPrompt,
  {
    temperature = 0.7,
    maxTokens = 1400
  } = {}
) {
  const key = getApiKey();

  if (!key) {
    throw new Error("No API key set");
  }

  const res = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: userPrompt
          }
        ],
        temperature,
        max_tokens: maxTokens
      })
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");

    if (res.status === 401) {
      throw new Error("Invalid API key");
    }

    throw new Error(
      `API error ${res.status}${
        errText ? ": " + errText.slice(0, 200) : ""
      }`
    );
  }

  const data = await res.json();

  const content =
    data?.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("Empty response from AI");
  }

  return content;
}


// ---------- Remove markdown fences ----------
function stripMarkdownFences(text) {
  let cleaned = String(text || "").trim();

  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "");
  cleaned = cleaned.replace(/\s*```$/i, "");

  return cleaned.trim();
}


// ---------- Extract the first complete JSON value ----------
function extractJsonValue(text) {
  const cleaned = stripMarkdownFences(text);

  const firstObject = cleaned.indexOf("{");
  const firstArray = cleaned.indexOf("[");

  let start = -1;

  if (firstObject === -1) {
    start = firstArray;
  } else if (firstArray === -1) {
    start = firstObject;
  } else {
    start = Math.min(firstObject, firstArray);
  }

  if (start === -1) {
    throw new Error("No JSON object or array found in AI response");
  }

  const opening = cleaned[start];
  const closing = opening === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i++) {
    const char = cleaned[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === opening) {
      depth++;
    } else if (char === closing) {
      depth--;

      if (depth === 0) {
        return cleaned.slice(start, i + 1);
      }
    }
  }

  throw new Error("Incomplete JSON returned by AI");
}


// ---------- Parse JSON normally ----------
function parseJsonLoose(text) {
  const candidate = extractJsonValue(text);

  try {
    return JSON.parse(candidate);
  } catch (error) {
    const err = new Error(
      `Invalid JSON returned by AI: ${error.message}`
    );

    err.rawResponse = candidate;

    throw err;
  }
}


// ---------- Repair malformed JSON using a second AI pass ----------
async function repairJson(rawText, expectedType = "object") {
  const repairSystem = `
You are a JSON repair engine.

Your ONLY task is to convert malformed AI output into valid JSON.

Rules:
1. Return ONLY valid JSON.
2. Do not use markdown fences.
3. Do not add explanations.
4. Preserve the original meaning and wording as much as possible.
5. Every JSON property name must use double quotes.
6. Every string value must use double quotes.
7. Escape internal double quotes correctly.
8. Do not invent missing information.
9. The result must be a ${expectedType}.
`;

  const repairUser = `
Repair the following malformed response.

Expected JSON type: ${expectedType}

Malformed response:

${rawText}
`;

  const repaired = await groqChat(
    repairSystem,
    repairUser,
    {
      temperature: 0.1,
      maxTokens: 1800
    }
  );

  return parseJsonLoose(repaired);
}


// ---------- Parse with automatic repair ----------
async function parseJsonWithRepair(text, expectedType = "object") {
  try {
    return parseJsonLoose(text);
  } catch (firstError) {
    console.warn(
      "Initial JSON parsing failed. Attempting AI repair.",
      firstError
    );

    try {
      return await repairJson(text, expectedType);
    } catch (repairError) {
      console.error("JSON repair failed:", repairError);

      const finalError = new Error(
        "The AI generated content, but the response was not valid JSON."
      );

      finalError.originalError = firstError;
      finalError.repairError = repairError;
      finalError.rawResponse = text;

      throw finalError;
    }
  }
}


// ---------- Slugify ----------
function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}


// ---------- Section-specific prompt builders ----------
const SECTION_PROMPTS = {

  ot: {
    system: `
You are a Bible content generator for an app called "Beyond the Verse".

You explore Old Testament stories and happenings, not standard
chapter-by-chapter reading.

Write in an engaging, human, narrative-nonfiction style.

Be historically and textually grounded.
Briefly acknowledge genuine scholarly or interpretive disputes
where relevant.

Never fabricate a chapter or verse reference.

IMPORTANT JSON RULES:
- Return ONLY valid JSON.
- Use double quotes around every property name.
- Use double quotes around every string value.
- Never place unquoted prose inside JSON.
- Never use markdown fences.
`,

    batchInstruction: (n, exclude) => `
Generate ${n} distinct Old Testament stories or happenings.

Avoid these already-shown titles:
${exclude.length ? exclude.join("; ") : "none"}

Return ONLY this JSON structure, filled with content:

[
  {
    "title": "",
    "reference": "",
    "era": "",
    "summary": ""
  }
]

Requirements:
- Exactly ${n} objects.
- "title" must be a string.
- "reference" must be a real Bible book/chapter reference.
- "era" must be a short phrase.
- "summary" must be one engaging sentence under 25 words.
`,

    detailInstruction: (item) => `
Write the full entry for the Old Testament story titled
"${item.title}" (${item.reference}).

Return ONLY this JSON structure, filled with content:

{
  "content": [
    "",
    "",
    ""
  ],
  "tags": [
    "",
    "",
    ""
  ]
}

Requirements:
- "content" must contain exactly 3 paragraphs.
- Each paragraph should be 80-160 words.
- "tags" must contain exactly 3 short lowercase theme tags.
- Each tag should be 1-2 words.
- Every string must be enclosed in double quotes.
`
  },


  nt: {
    system: `
You are a Bible content generator for an app called "Beyond the Verse".

You explore New Testament stories and happenings, including the Gospels,
Acts, and notable events referenced in the Epistles.

Write in an engaging, human, narrative-nonfiction style.

Be textually grounded.
Briefly acknowledge genuine scholarly or interpretive disputes where relevant.

Never fabricate a chapter or verse reference.

IMPORTANT JSON RULES:
- Return ONLY valid JSON.
- Use double quotes around every property name.
- Use double quotes around every string value.
- Never place unquoted prose inside JSON.
- Never use markdown fences.
`,

    batchInstruction: (n, exclude) => `
Generate ${n} distinct New Testament stories or happenings.

Avoid these already-shown titles:
${exclude.length ? exclude.join("; ") : "none"}

Return ONLY this JSON structure:

[
  {
    "title": "",
    "reference": "",
    "era": "",
    "summary": ""
  }
]

Requirements:
- Exactly ${n} objects.
- "title" must be a string.
- "reference" must be a real Bible book/chapter reference.
- "era" must be a short phrase.
- "summary" must be one engaging sentence under 25 words.
`,

    detailInstruction: (item) => `
Write the full entry for the New Testament story titled
"${item.title}" (${item.reference}).

Return ONLY this JSON structure:

{
  "content": [
    "",
    "",
    ""
  ],
  "tags": [
    "",
    "",
    ""
  ]
}

Requirements:
- Exactly 3 paragraphs.
- Each paragraph should be 80-160 words.
- Exactly 3 short lowercase theme tags.
`
  },


  characters: {
    system: `
You are a Bible content generator for an app called "Beyond the Verse".

You profile Bible characters with real depth, rather than merely giving
their names and titles.

Write in an engaging, human style.

Be textually grounded.
Acknowledge genuine scholarly or interpretive disputes where relevant.

Never fabricate a chapter, verse reference, or quotation.

IMPORTANT JSON RULES:
- Return ONLY valid JSON.
- Use double quotes around every property name.
- Use double quotes around every string value.
- Never place unquoted prose inside JSON.
- Never use markdown fences.
`,

    batchInstruction: (n, exclude) => `
Generate ${n} distinct Bible characters from the Old or New Testament.

Avoid these already-shown names:
${exclude.length ? exclude.join("; ") : "none"}

Return ONLY this JSON structure:

[
  {
    "name": "",
    "title": "",
    "reference": "",
    "era": "",
    "bio": ""
  }
]

Requirements:
- Exactly ${n} objects.
- "name" must be a string.
- "title" must be a short evocative epithet.
- "reference" must be a real book range.
- "era" must be a short phrase.
- "bio" must be one teaser sentence under 25 words.
`,

    detailInstruction: (item) => `
Write the full profile for the Bible character
"${item.name}" (${item.title}, ${item.reference}).

Return ONLY this JSON structure:

{
  "bio": "",
  "qualities": [
    "",
    "",
    "",
    ""
  ],
  "quotes": [
    ""
  ],
  "keyMoments": [
    ""
  ]
}

Requirements:
- "bio" must contain 3-5 sentences.
- "qualities" must contain exactly 4 short phrases.
- Qualities may include flaws as well as virtues.
- "quotes" must contain 1-2 real or closely paraphrased quotations.
- Each quotation must include its reference in parentheses.
- "keyMoments" must contain 1-2 short phrases.
- Do not invent quotations.
`
  },


  backstories: {
    system: `
You are a Bible content generator for an app called "Beyond the Verse".

You surface lesser-known, strange, obscure, or debated details from the Bible.

Write in an engaging, curious, human style.

Be textually grounded.
Include genuine scholarly debate where appropriate.

Never fabricate a chapter or verse reference.

IMPORTANT JSON RULES:
- Return ONLY valid JSON.
- Use double quotes around every property name.
- Use double quotes around every string value.
- Never place unquoted prose inside JSON.
- Never use markdown fences.
`,

    batchInstruction: (n, exclude) => `
Generate ${n} distinct interesting Bible backstory entries.

These can involve:
- strange details
- obscure passages
- unusual objects
- side characters
- debated interpretations
- easily overlooked details

Avoid these already-shown titles:
${exclude.length ? exclude.join("; ") : "none"}

Return ONLY this JSON structure:

[
  {
    "title": "",
    "reference": "",
    "hook": ""
  }
]

Requirements:
- Exactly ${n} objects.
- "title" must be a string.
- "reference" must be a real Bible book/chapter reference.
- "hook" must be one intriguing teaser sentence under 25 words.
`,

    detailInstruction: (item) => `
Write the full entry for the backstory titled
"${item.title}" (${item.reference}).

Return ONLY this JSON structure:

{
  "content": [
    "",
    "",
    ""
  ]
}

Requirements:
- Exactly 3 paragraphs.
- Each paragraph should be 80-160 words.
- Explain the backstory clearly.
- Include genuine scholarly debate where relevant.
`
  }
};


// ---------- Public: generate a batch ----------
async function generateBatch(section, count = 8) {
  const cfg = SECTION_PROMPTS[section];

  if (!cfg) {
    throw new Error(`Unknown section: ${section}`);
  }

  const exclude = getSeenTitles(section);

  const userPrompt = cfg.batchInstruction(
    count,
    exclude
  );

  const raw = await groqChat(
    cfg.system,
    userPrompt,
    {
      temperature: 0.7,
      maxTokens: 1200
    }
  );

  const parsed = await parseJsonWithRepair(
    raw,
    "array"
  );

  if (!Array.isArray(parsed)) {
    throw new Error("Unexpected batch format");
  }

  const items = parsed.map((obj) => {
    const label = obj.title || obj.name;

    if (!label) {
      throw new Error("AI returned an item without a title or name");
    }

    return {
      ...obj,
      id:
        slugify(label) +
        "-" +
        Math.random()
          .toString(36)
          .slice(2, 7)
    };
  });

  addSeenTitles(
    section,
    items.map((i) => i.title || i.name)
  );

  return items;
}


// ---------- Public: generate full detail ----------
async function generateDetail(section, teaser) {
  const cfg = SECTION_PROMPTS[section];

  if (!cfg) {
    throw new Error(`Unknown section: ${section}`);
  }

  const userPrompt = cfg.detailInstruction(teaser);

  const raw = await groqChat(
    cfg.system,
    userPrompt,
    {
      temperature: 0.7,
      maxTokens: 1600
    }
  );

  const parsed = await parseJsonWithRepair(
    raw,
    "object"
  );

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new Error("Unexpected detail format");
  }

  return {
    ...teaser,
    ...parsed
  };
}


// ---------- Public: follow-up Q&A ----------
async function askAboutEntry(
  item,
  section,
  question
) {
  const label = item.title || item.name;

  const contextParts = [];

  if (item.reference) {
    contextParts.push(
      `Reference: ${item.reference}`
    );
  }

  if (item.era) {
    contextParts.push(
      `Era: ${item.era}`
    );
  }

  if (item.summary) {
    contextParts.push(
      `Summary: ${item.summary}`
    );
  }

  if (item.hook) {
    contextParts.push(
      `Hook: ${item.hook}`
    );
  }

  if (item.bio) {
    contextParts.push(
      `Bio: ${item.bio}`
    );
  }

  if (item.content) {
    contextParts.push(
      `Full account: ${item.content.join(" ")}`
    );
  }

  if (item.qualities) {
    contextParts.push(
      `Qualities: ${item.qualities.join(", ")}`
    );
  }

  if (item.quotes) {
    contextParts.push(
      `Quotes: ${item.quotes.join(" | ")}`
    );
  }

  const systemPrompt = `
You are a knowledgeable, warm Bible study companion
inside an app called "Beyond the Verse".

The user is reading about "${label}".

Answer their follow-up question using the context below
plus your general knowledge of the Bible.

Keep answers conversational and concise,
under 150 words unless the user asks for more.

Stay grounded in the biblical text.

If something is disputed among scholars or traditions,
say so briefly rather than presenting one view as settled fact.

Do not invent chapter or verse references.

Context on ${label}:

${contextParts.join("\n")}
`;

  return groqChat(
    systemPrompt,
    question,
    {
      temperature: 0.6,
      maxTokens: 400
    }
  );
}
