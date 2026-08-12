# Beyond the Verse

A Bible PWA that is not about reading chapters and verses. It is about the stories, characters, and stranger corners of the Bible: who these people were, what happened, and the backstories most people skip past.

## Sections
- **Old Testament Stories**
- **New Testament Stories**
- **Characters** — bio, key moments, qualities/personality, notable quotes
- **Interesting Backstories** — the strange, obscure, and debated details

## How it works
Every entry in every section is written live by AI (Groq, free tier) the moment you open that section, not pulled from a fixed list. Tap "Generate more" for a fresh batch any time. The app remembers what titles you've already seen (stored on your device) and asks the AI to avoid repeating them, so it stays varied across visits instead of running out of material.

This means the app needs an internet connection and a free Groq API key to show anything. There's no offline fallback content by design, that was a deliberate trade for keeping the content endless and non-repetitive rather than capped at a small bundled set.

## Getting a free Groq key
1. Go to console.groq.com and sign up (free).
2. Create an API key.
3. Paste it into the app's Settings screen (⚙ top right).
4. Your key is stored only in your browser's `localStorage` and sent only to Groq's API, directly from your device.

## Deploying
**GitHub Pages**
1. Push this folder's contents to a repo.
2. Repo Settings → Pages → deploy from the branch/root.
3. Visit the URL, then use "Add to Home Screen" (mobile) or the install icon (desktop) to install it as an app.

**Netlify Drop**
1. Go to app.netlify.com/drop
2. Drag this whole folder in.
3. Done, installable PWA at the generated URL.

## How generation works
- `js/ai.js` holds one prompt pair per section (`ot`, `nt`, `characters`, `backstories`): a `batchInstruction` that asks for a list of short teasers (title/reference/era/one-line summary), and a `detailInstruction` that asks for the full write-up once a user taps into one.
- Batches are requested 8 at a time. Full detail is only generated when a user actually opens an entry, to save API calls.
- The "Ask about..." box on every detail page reuses the same Groq call for open-ended follow-up questions grounded in that entry's generated content.
- Already-seen titles per section are kept in `localStorage` (capped at the most recent 60) and passed back to the model as an exclusion list on each new batch request.

## Tech
Vanilla HTML/CSS/JS, no build step, no framework. Service worker caches the app shell (HTML/CSS/JS/icons) for installability, but not content, since content is always generated fresh.
