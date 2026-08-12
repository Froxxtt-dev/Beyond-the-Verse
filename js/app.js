// ---------- State ----------
let currentRoute = { view: "home" };
const sectionState = {
  ot: { items: [], loading: false, error: null },
  nt: { items: [], loading: false, error: null },
  characters: { items: [], loading: false, error: null },
  backstories: { items: [], loading: false, error: null }
};
const detailCache = {}; // id -> full item

const SECTION_META = {
  ot: { label: "Old Testament Stories", glyph: "OT", class: "ot" },
  nt: { label: "New Testament Stories", glyph: "NT", class: "nt" },
  characters: { label: "Characters", glyph: "C", class: "characters" },
  backstories: { label: "Interesting Backstories", glyph: "?", class: "backstories" }
};

function findItem(section, id) {
  return sectionState[section].items.find((x) => x.id === id) || detailCache[id];
}

// ---------- Routing ----------
function navigate(route) {
  currentRoute = route;
  render();
  window.scrollTo(0, 0);
}

function goHome() { navigate({ view: "home" }); }
function goSection(section) { navigate({ view: "list", section }); }
function goDetail(section, id) { navigate({ view: "detail", section, id }); }
function goSettings() { navigate({ view: "settings" }); }

// ---------- Rendering ----------
function render() {
  renderTopbar();
  renderTabbar();
  const main = document.getElementById("main");
  main.innerHTML = "";

  if (currentRoute.view === "home") main.appendChild(renderHome());
  else if (currentRoute.view === "list") main.appendChild(renderList(currentRoute.section));
  else if (currentRoute.view === "detail") main.appendChild(renderDetail(currentRoute.section, currentRoute.id));
  else if (currentRoute.view === "settings") main.appendChild(renderSettings());
}

function renderTopbar() {
  const back = document.getElementById("topbar-back");
  back.style.visibility = currentRoute.view === "home" ? "hidden" : "visible";
  back.onclick = () => {
    if (currentRoute.view === "detail") goSection(currentRoute.section);
    else goHome();
  };
}

function renderTabbar() {
  document.querySelectorAll(".tabbar button[data-tab]").forEach((btn) => {
    const tab = btn.dataset.tab;
    const isActive =
      (tab === "home" && currentRoute.view === "home") ||
      (currentRoute.view === "list" && currentRoute.section === tab) ||
      (currentRoute.view === "detail" && currentRoute.section === tab);
    btn.classList.toggle("active", isActive);
  });
}

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

// ---------- Home ----------
function renderHome() {
  const wrap = el("div");

  const hero = el("div", "home-hero");
  hero.innerHTML = `
    <div class="home-hero__eyebrow">Beyond the Verse</div>
    <h1>Stories behind the Scripture</h1>
    <p>Characters, happenings, and hidden corners of the Bible, told for what they are: strange, human, and worth knowing well. New entries generated every time you visit.</p>
  `;
  wrap.appendChild(hero);

  if (!hasApiKey()) {
    const banner = el("div", "home-daily");
    banner.innerHTML = `
      <div class="eyebrow">Get Started</div>
      <h2>Add a free API key</h2>
      <p>Every section here is written fresh by AI on each visit, so it takes a free Groq key to get going. It only takes a minute.</p>
      <button>Go to Settings</button>
    `;
    banner.querySelector("button").onclick = goSettings;
    wrap.appendChild(banner);
  }

  const grid = el("div", "section-grid");
  Object.entries(SECTION_META).forEach(([key, meta]) => {
    const card = el("button", `section-card ${meta.class}`);
    const count = sectionState[key].items.length;
    card.innerHTML = `
      <div class="section-card__glyph">${meta.glyph}</div>
      <div class="section-card__title">${meta.label}</div>
      <div class="section-card__count">${count ? count + " loaded" : "Tap to generate"}</div>
    `;
    card.onclick = () => goSection(key);
    grid.appendChild(card);
  });
  wrap.appendChild(grid);

  return wrap;
}

// ---------- List ----------
function renderList(section) {
  const meta = SECTION_META[section];
  const state = sectionState[section];
  const wrap = el("div");
  wrap.appendChild(el("div", "eyebrow", meta.label));
  wrap.appendChild(el("h2", "view-title", meta.label));

  if (!hasApiKey()) {
    wrap.appendChild(renderNoKeyNotice());
    return wrap;
  }

  const search = el("input", "list-search");
  search.type = "text";
  search.placeholder = `Filter loaded ${meta.label.toLowerCase()}...`;
  wrap.appendChild(search);

  const listContainer = el("div");
  wrap.appendChild(listContainer);

  const actionRow = el("div");
  actionRow.style.marginTop = "16px";
  const genBtn = el("button", "settings-save", state.items.length ? "Generate more" : `Generate ${meta.label.toLowerCase()}`);
  actionRow.appendChild(genBtn);
  wrap.appendChild(actionRow);

  function renderRows(filterText) {
    listContainer.innerHTML = "";

    if (state.loading && !state.items.length) {
      listContainer.appendChild(renderSkeletonRows());
      return;
    }

    if (state.error && !state.items.length) {
      listContainer.appendChild(renderErrorState(state.error));
      return;
    }

    const items = state.items.filter((item) => {
      if (!filterText) return true;
      const hay = `${item.title || item.name} ${item.summary || item.hook || item.bio || ""}`.toLowerCase();
      return hay.includes(filterText.toLowerCase());
    });

    if (!items.length) {
      listContainer.appendChild(el("div", "empty-state", state.items.length ? "Nothing matches that filter." : "Nothing generated yet."));
      return;
    }

    items.forEach((item, i) => {
      const row = el("button", "item-row");
      const num = String(i + 1).padStart(2, "0");
      row.innerHTML = `
        <div class="item-row__num">${num}</div>
        <div class="item-row__body">
          <div class="item-row__title">${escapeHtml(item.title || item.name)}</div>
          <div class="item-row__meta">${item.reference ? escapeHtml(item.reference) : ""}${item.era ? " · " + escapeHtml(item.era) : ""}</div>
          <div class="item-row__summary">${escapeHtml(item.summary || item.hook || item.bio || "")}</div>
        </div>
      `;
      row.onclick = () => goDetail(section, item.id);
      listContainer.appendChild(row);
    });
  }

  async function loadBatch() {
    state.loading = true;
    state.error = null;
    genBtn.disabled = true;
    genBtn.textContent = "Generating...";
    renderRows(search.value);

    try {
      const newItems = await generateBatch(section, 8);
      state.items = [...state.items, ...newItems];
    } catch (err) {
      state.error = err.message || "Something went wrong";
    } finally {
      state.loading = false;
      genBtn.disabled = false;
      genBtn.textContent = "Generate more";
      renderRows(search.value);
    }
  }

  genBtn.onclick = loadBatch;
  search.addEventListener("input", () => renderRows(search.value));

  renderRows("");
  if (!state.items.length && !state.loading && !state.error) loadBatch();

  return wrap;
}

function renderSkeletonRows() {
  const wrap = el("div");
  for (let i = 0; i < 5; i++) {
    const row = el("div", "item-row");
    row.style.opacity = "0.5";
    row.innerHTML = `
      <div class="item-row__num">··</div>
      <div class="item-row__body">
        <div class="item-row__title">Writing something new...</div>
        <div class="item-row__summary">The AI is drafting fresh entries.</div>
      </div>
    `;
    wrap.appendChild(row);
  }
  return wrap;
}

function renderErrorState(message) {
  const wrap = el("div", "empty-state");
  wrap.innerHTML = `Couldn't generate content: ${escapeHtml(message)}.<br/>Check your API key in Settings, or try again.`;
  return wrap;
}

function renderNoKeyNotice() {
  const box = el("div", "hook-box");
  box.innerHTML = `This section is written by AI, so it needs a free Groq API key first. <button id="notice-settings-link" style="background:none;border:none;color:var(--indigo);font-weight:600;text-decoration:underline;padding:0;font-family:inherit;cursor:pointer;">Add one in Settings</button>.`;
  setTimeout(() => {
    const link = document.getElementById("notice-settings-link");
    if (link) link.onclick = goSettings;
  });
  return box;
}

// ---------- Detail ----------
function renderDetail(section, id) {
  const wrap = el("div");
  const teaser = findItem(section, id);

  if (!teaser) {
    wrap.appendChild(el("div", "empty-state", "That entry could not be found. It may have come from a different session."));
    return wrap;
  }

  if (detailCache[id]) {
    return section === "characters" ? renderCharacterDetail(detailCache[id]) : renderStoryDetail(section, detailCache[id]);
  }

  wrap.appendChild(el("div", "eyebrow", SECTION_META[section].label));
  wrap.appendChild(el("h1", "view-title", teaser.title || teaser.name));
  wrap.appendChild(renderDetailSkeleton());

  generateDetail(section, teaser)
    .then((full) => {
      detailCache[id] = full;
      if (currentRoute.view === "detail" && currentRoute.id === id) render();
    })
    .catch((err) => {
      if (currentRoute.view === "detail" && currentRoute.id === id) {
        const main = document.getElementById("main");
        main.innerHTML = "";
        main.appendChild(el("div", "eyebrow", SECTION_META[section].label));
        main.appendChild(el("h1", "view-title", teaser.title || teaser.name));
        main.appendChild(renderErrorState(err.message || "Something went wrong"));
      }
    });

  return wrap;
}

function renderDetailSkeleton() {
  const wrap = el("div", "dropcap-block");
  wrap.style.opacity = "0.55";
  wrap.appendChild(el("p", null, "Writing the full account..."));
  return wrap;
}

function renderStoryDetail(section, item) {
  const wrap = el("div");
  wrap.appendChild(el("div", "eyebrow", SECTION_META[section].label));
  wrap.appendChild(el("h1", "view-title", item.title));

  const meta = el("div", "detail-meta");
  meta.innerHTML = `${item.reference ? `<span>📖 ${escapeHtml(item.reference)}</span>` : ""}${item.era ? `<span>🕑 ${escapeHtml(item.era)}</span>` : ""}`;
  wrap.appendChild(meta);

  if (item.hook) wrap.appendChild(el("div", "hook-box", escapeHtml(item.hook)));

  const body = el("div", "dropcap-block");
  (item.content || []).forEach((para) => body.appendChild(el("p", null, escapeHtml(para))));
  wrap.appendChild(body);

  if (item.tags && item.tags.length) {
    const tagRow = el("div", "tag-row");
    item.tags.forEach((t) => tagRow.appendChild(el("span", "tag-pill", escapeHtml(t))));
    wrap.appendChild(tagRow);
  }

  wrap.appendChild(renderAskBox(section, item));
  return wrap;
}

function renderCharacterDetail(item) {
  const wrap = el("div");
  wrap.appendChild(el("div", "eyebrow", "Character"));

  const header = el("div", "char-header");
  const initial = (item.name || "?").charAt(0);
  header.innerHTML = `
    <div class="char-seal">${escapeHtml(initial)}</div>
    <div>
      <div class="char-name">${escapeHtml(item.name)}</div>
      <div class="char-title">${escapeHtml(item.title || "")}</div>
    </div>
  `;
  wrap.appendChild(header);

  const meta = el("div", "detail-meta");
  meta.style.marginTop = "14px";
  meta.innerHTML = `${item.reference ? `<span>📖 ${escapeHtml(item.reference)}</span>` : ""}${item.era ? `<span>🕑 ${escapeHtml(item.era)}</span>` : ""}`;
  wrap.appendChild(meta);

  wrap.appendChild(el("div", "section-label", "Who they were"));
  const bio = el("div", "dropcap-block");
  bio.appendChild(el("p", null, escapeHtml(item.bio || "")));
  wrap.appendChild(bio);

  if (item.qualities && item.qualities.length) {
    wrap.appendChild(el("div", "section-label", "Qualities & Personality"));
    const ul = el("ul", "quality-list");
    item.qualities.forEach((q) => ul.appendChild(el("li", null, escapeHtml(q))));
    wrap.appendChild(ul);
  }

 if (item.quotes && item.quotes.length) {
    wrap.appendChild(el("div", "section-label", "Notable Words"));
    item.quotes.forEach((q) => {
      const text = typeof q === "string" ? q : `"${q.text}"${q.reference ? " (" + q.reference + ")" : ""}`;
      wrap.appendChild(el("div", "quote-block", escapeHtml(text)));
    });
  }

  if (item.keyMoments && item.keyMoments.length) {
    wrap.appendChild(el("div", "section-label", "Key Moments"));
    const chipWrap = el("div");
    item.keyMoments.forEach((m) => chipWrap.appendChild(el("span", "related-chip", escapeHtml(m))));
    wrap.appendChild(chipWrap);
  }

  wrap.appendChild(renderAskBox("characters", item));
  return wrap;
}

// ---------- Ask AI ----------
function renderAskBox(section, item) {
  const box = el("div", "ask-box");
  const label = item.title || item.name;
  box.appendChild(el("div", "section-label", `Ask about ${escapeHtml(label)}`));
  box.querySelector(".section-label").style.marginTop = "0";

  const thread = el("div", "ask-thread");
  const promptRow = el("div", "ask-box__prompt");
  const input = el("input");
  input.type = "text";
  input.placeholder = "Ask a follow-up question...";
  const sendBtn = el("button", "ask-send", "Ask");
  promptRow.appendChild(input);
  promptRow.appendChild(sendBtn);

  box.appendChild(thread);
  box.appendChild(promptRow);

  async function send() {
    const question = input.value.trim();
    if (!question) return;
    input.value = "";
    sendBtn.disabled = true;

    thread.appendChild(el("div", "ask-msg user", escapeHtml(question)));
    const pending = el("div", "ask-msg assistant pending", "Thinking...");
    thread.appendChild(pending);

    try {
      const answer = await askAboutEntry(item, section, question);
      pending.textContent = answer;
      pending.classList.remove("pending");
    } catch (err) {
      pending.textContent = "Couldn't reach the AI right now (" + (err.message || "unknown error") + ").";
      pending.classList.remove("pending");
    } finally {
      sendBtn.disabled = false;
    }
  }

  sendBtn.onclick = send;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });

  return box;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str == null ? "" : String(str);
  return d.innerHTML;
}

// ---------- Settings ----------
function renderSettings() {
  const wrap = el("div");
  wrap.appendChild(el("div", "eyebrow", "Settings"));
  wrap.appendChild(el("h1", "view-title", "AI Setup"));
  wrap.appendChild(el("p", "view-subtitle", "Every story, character, and backstory in this app is written by AI using a free Groq API key. Nothing loads until a key is added."));

  const field = el("div", "settings-field");
  field.innerHTML = `
    <label for="api-key-input">Groq API Key</label>
    <input id="api-key-input" type="password" placeholder="gsk_..." autocomplete="off" />
    <small>Get a free key at console.groq.com. Stored only on this device, sent only to Groq.</small>
  `;
  wrap.appendChild(field);

  const saveBtn = el("button", "settings-save", "Save Key");
  const status = el("div", "settings-status");
  wrap.appendChild(saveBtn);
  wrap.appendChild(status);

  const input = field.querySelector("#api-key-input");
  input.value = getApiKey() || "";

  saveBtn.onclick = () => {
    setApiKey(input.value.trim());
    status.textContent = input.value.trim() ? "Saved. Head to any section to start generating." : "Key cleared.";
  };

  return wrap;
}

// ---------- Init ----------
function init() {
  render();

  window.addEventListener("online", updateOfflineBanner);
  window.addEventListener("offline", updateOfflineBanner);
  updateOfflineBanner();

  document.querySelectorAll(".tabbar button[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (tab === "home") goHome();
      else goSection(tab);
    });
  });
  document.getElementById("settings-link").addEventListener("click", goSettings);
}

function updateOfflineBanner() {
  const banner = document.getElementById("offline-banner");
  banner.classList.toggle("show", !navigator.onLine);
}

document.addEventListener("DOMContentLoaded", init);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW registration failed", e));
  });
}
