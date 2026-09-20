(() => {
  // Only run on the intended page
  if (!/\/fchat\/getLog\.php/i.test(location.pathname)) return;

  // If URL contains off flag, strip it from URL and bail (show original page)
  try {
    const url = new URL(location.href);
    if (url.searchParams.get('fhl_off') === '1') {
      url.searchParams.delete('fhl_off');
      history.replaceState(null, '', url.toString());
      return;
    }
  } catch {}

  // Allow disabling the extension once (until next reload) via a session flag
  const DISABLE_ONCE_KEY = "fchatHighlighterDisableOnce";
  try {
    if (sessionStorage.getItem(DISABLE_ONCE_KEY) === "1") {
      sessionStorage.removeItem(DISABLE_ONCE_KEY);
      return;
    }
  } catch {}

  // Compare helper: does the text after the timestamp start with the given name?
  // - Ignores an optional leading '*' (emote style)
  // - Case-insensitive
  // - Requires a sensible boundary after the name (end, space, ':', '[')
  function afterStartsWithName(afterText, name) {
    if (!name) return false;
    const s = (afterText || "").replace(/^\s*\*/, "").trimStart();
    const n = (name || "").trim();
    const sLC = s.toLowerCase();
    const nLC = n.toLowerCase();
    if (!sLC.startsWith(nLC)) return false;
    const next = s.slice(n.length, n.length + 1);
    return next === "" || next === " " || next === ":" || next === "[";
  }

  function makeLegendItem(color, label, key) {
    const span = document.createElement("span");
    const sw = document.createElement("span");
    sw.style.cssText = `display:inline-block; width:12px; height:12px; background:${color}; border:1px solid rgba(255,255,255,0.12); vertical-align:middle; margin-right:6px;`;
    span.appendChild(sw);
    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    span.appendChild(labelEl);
    if (key) {
      span.style.cursor = "pointer";
      span.title = "Click to toggle this highlight";
      span.style.userSelect = "none";
      const applyState = () => {
        const enabled = (highlightToggles && Object.prototype.hasOwnProperty.call(highlightToggles, key)) ? !!highlightToggles[key] : true;
        sw.style.opacity = enabled ? "1" : "0.25";
        span.style.opacity = enabled ? "1" : "0.7";
        labelEl.style.color = enabled ? "#e6e6e6" : "#9aa7bd";
        labelEl.style.textDecoration = enabled ? "none" : "line-through";
      };
      span.addEventListener("click", () => {
        try {
          highlightToggles[key] = !highlightToggles[key];
          localStorage.setItem(TOGGLE_STORE_KEY, JSON.stringify(highlightToggles));
        } catch {}
        applyState();
        updateHighlights();
      });
      setTimeout(applyState, 0);
    }
    return span;
  }

  // Count [icon] and [eicon] occurrences in a text block
  function countIcons(text) {
    if (!text) return 0;
    const m = String(text).match(/\[(?:icon|eicon)\]/gi);
    return m ? m.length : 0;
  }

  // Detect a line that starts a new message: [HH:MM] or [HH:MM AM/PM] or [YYYY-MM-DD HH:MM] with optional AM/PM
  const headerRe = /^\s*\[(?:\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?|\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)\]\s*(.*)$/i;
  const tsStartRe = /^\s*\[(?:\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?|\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)\]/i;

  // Ads filter refined:
  // - Spare if the first non-space character after timestamp is '*'
  // - OR if within the first 22 characters after timestamp (including spaces),
  //   there is a ':' that ends a word (i.e., previous char is alphanumeric, next is whitespace or end)
  function adsCheckFirst22(textAfterTsIncludingSpaces) {
    const s = String(textAfterTsIncludingSpaces || "");
    const trimmed = s.replace(/^\s+/, "");
    if (trimmed.startsWith('*')) return true;
    const limit = Math.min(22, s.length);
    for (let i = 0; i < limit; i++) {
      if (s[i] === ':') {
        const prev = i > 0 ? s[i - 1] : '';
        const next = (i + 1 < s.length) ? s[i + 1] : '';
        const prevIsWord = /[A-Za-z0-9]/.test(prev);
        const nextOk = next === ' ';
        if (prevIsWord && nextOk) return true;
      }
    }
    return false;
  }

  // Extract page text. Many of these logs are plain text; innerText preserves line breaks reasonably.
  const fullText = document.body ? (document.body.innerText || document.body.textContent || "") : "";
  // Also keep the raw HTML so we can detect structural markers like <hr/>
  const fullHtml = document.body ? (document.body.innerHTML || "") : "";
  // Preserve the site's native latest-report target before replacing the page DOM.
  let latestReportUrl = null;
  try {
    const latestReportLink = Array.from(document.querySelectorAll("a[href]")).find(link =>
      link.textContent.trim() === ">>" && /\/fchat\/getLog\.php(?:\?|$)/i.test(link.href)
    );
    if (latestReportLink) latestReportUrl = latestReportLink.href;
  } catch {}
  // Prefer <pre> for message parsing so newline-only messages aren't collapsed away.
  let messageText = fullText;
  try {
    const pre = document.querySelector("pre");
    const preText = pre ? (pre.textContent || "") : "";
    if (preText.length > 0) messageText = preText;
  } catch {}
  if (!fullText.trim() && !messageText.trim()) return;

  // Pull submitter and reporter names
  let submittedBy = null;
  {
    const m = fullText.match(/Log submitted by:\s*([^\n\r]+?)(?=(?:\r?\n|Log submitted on:|Reporting user:|Tab:|Report text:|$))/i);
    if (m) submittedBy = m[1].trim();
  }
  let submittedOn = null;
  {
    const m = fullText.match(/Log submitted on:\s*([^\n\r]+?)(?=(?:\r?\n|Reporting user:|Tab:|Report text:|$))/i);
    if (m) submittedOn = m[1].trim();
  }
  let reportingUser = null;
  {
    const m = fullText.match(/Reporting user:\s*([^\n\r]+?)(?=(?:\r?\n|Tab:|Report text:|$))/i);
    if (m) reportingUser = m[1].trim();
  }
  let tabName = null;
  {
    const m = fullText.match(/Tab:\s*([^\n\r]+?)(?=(?:\r?\n|Report text:|$))/i);
    if (m) tabName = m[1].trim();
  }
  // Slugs to star when matched in parentheses at the end of tab name
  function canonSlug(s) {
    return String(s || "")
      .toLowerCase()
      .trim()
      .replace(/[\u2019\u2018']/g, '')
      .replace(/[’']/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  const STAR_TAB_SLUGS = new Set([
    'sex driven lfrp','fantasy','ageplay','story driven lfrp','domination/submission','force/non-con','pregnancy and impregnation',
    "monster's lair",'ferals / bestiality','furries','love and affection','humans/humanoids','sci-fi','canon characters',
    'cum lovers','mind control','femboy','hyper endowed','straight roleplay','vore','para/multi-para rp','femdom','transformation',
    'all in the family','canon characters ooc','lesbians','pokefurs','dragons','superheroes','gay furry males','bondage','ass play',
    'watersports','world of warcraft','gay males','hermaphrodites','fat and pudgy','footplay','sadism/masochism','latex','transgender',
    'german ooc','muscle bound','micro/macro','equestria','scat play','diapers/infantilism','rp dark city','inflation','cuntboys',
    'rp bar','gamers','artists / writers','warhammer general','the slob den','gore','non-sexual rp','avians','helpdesk','german furry',
    'german ic','medical play','frontpage','development'
  ].map(canonSlug));
  function extractParenSlug(s) {
    try {
      const text = String(s || "");
      const m = text.match(/\(([^)]+)\)\s*$/);
      if (m) return m[1].trim();
    } catch {}
    return null;
  }
  // Report text can span multiple lines and may contain inline timestamps.
  // Stop ONLY when a timestamp starts a new line (either [HH:MM] or [YYYY-MM-DD HH:MM]), or end of text.
  // Additionally, the original HTML places an <hr/> immediately after the label when the report is empty.
  // Use that marker to avoid capturing the first chat line as the report text.
  let reportText = null;
  {
    // First detect the explicit empty case via <hr/> immediately following the label in HTML
    let emptyViaHr = false;
    try {
      const idx = fullHtml.toLowerCase().indexOf("report text:");
      if (idx !== -1) {
        const after = fullHtml.slice(idx + "report text:".length).toLowerCase();
        const afterTrim = after.replace(/^[\s\u00a0]+/, "");
        // If the very next non-whitespace token is an <hr>, treat as empty report
        emptyViaHr = /^<\s*hr\b/.test(afterTrim);
      }
    } catch {}

    if (!emptyViaHr) {
      // First attempt: stop at start-of-line timestamp
      let m = fullText.match(/Report text:\s*([\s\S]*?)(?=\r?\n\s*\[(?:\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?|\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)\]|$)/i);
      if (!m) {
        // Fallback: allow inline timestamp immediately after report text (no newline)
        const rtIdx = fullText.search(/Report text:/i);
        if (rtIdx !== -1) {
          const after = fullText.slice(rtIdx + (fullText.match(/Report text:/i) || [])[0].length);
          const tsIdx = after.search(/\[(?:\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?|\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)\]/i);
          if (tsIdx > 0) {
            m = [null, after.slice(0, tsIdx)];
          }
        }
      }
      if (m) {
        const val = m[1];
        if (val && val.replace(/\s+/g, "").length > 0) {
          reportText = val;
        } else {
          reportText = null;
        }
      }
    } else {
      reportText = null;
    }
  }

  const submittedByRaw = (submittedBy || "").trim();
  const reportingUserRaw = (reportingUser || "").trim();

  // Split into lines and group messages: header line -> body until next header
  const lines = messageText.split(/\r?\n/);
  const messages = []; // {afterNoStar: string, afterWithSpaces: string, blockLines: string[]}
  let cur = null;

  for (const line of lines) {
    const hm = line.match(headerRe);
    if (hm) {
      // Start new message
      if (cur) messages.push(cur);
      const after = hm[1] || "";
      // Extract sender after optional leading '*'
      const afterNoStar = after.replace(/^\s*\*/, "");
      const afterWithSpaces = (line || "").replace(tsStartRe, "");
      cur = { afterNoStar, afterWithSpaces, blockLines: [line] };
    } else {
      // Continuation
      if (cur) {
        cur.blockLines.push(line);
      } else {
        // Ignore leading preface before first header
      }
    }
  }
  if (cur) messages.push(cur);

  // If nothing to do, bail
  if (!messages.length) return;

  // Compute the maximum combined [icon]/[eicon] count in any single message from the reported user
  let maxReportedIcons = 0;
  try {
    for (const msg of messages) {
      const s = msg.afterNoStar || "";
      if (afterStartsWithName(s, reportingUserRaw)) {
        const cnt = countIcons(msg.blockLines.join("\n"));
        if (cnt > maxReportedIcons) maxReportedIcons = cnt;
      }
    }
  } catch {}

  // Build a new DOM rendering with highlighted blocks
  // Colors: semi-transparent to preserve readability
  const COLOR_REPORT = "rgba(255, 0, 0, 0.18)";   // red
  const COLOR_SUBMIT = "rgba(0, 102, 255, 0.18)"; // blue
  const COLOR_EXTRA  = "rgba(0, 170, 0, 0.18)";   // green for additional names

  // Legend toggle persistence
  const TOGGLE_STORE_KEY = "fchatHighlighterLegendToggles";
  let highlightToggles = { report: true, submit: true, extra: true };
  try {
    const savedToggles = localStorage.getItem(TOGGLE_STORE_KEY);
    if (savedToggles) {
      const t = JSON.parse(savedToggles);
      if (t && typeof t === 'object') {
        highlightToggles = { ...highlightToggles, ...t };
      }
    }
  } catch {}

  const COMPACT_STORE_KEY = "fchatHighlighterCompactMode";
  const TEXT_SIZE_STORE_KEY = "fchatHighlighterTextScale";
  const TEXT_SIZE_STEP = 0.1;
  const TEXT_SIZE_MIN = 0.5;
  const TEXT_SIZE_MAX = 1.5;

  function clampTextScale(value) {
    return Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, value));
  }

  let textScale = 1;
  try {
    const savedScale = parseFloat(localStorage.getItem(TEXT_SIZE_STORE_KEY) || "");
    if (!Number.isNaN(savedScale)) textScale = savedScale;
  } catch {}
  textScale = clampTextScale(textScale);

  let compactMode = false;
  try {
    compactMode = localStorage.getItem(COMPACT_STORE_KEY) === "1";
  } catch {}

  let textSizeDisplay = null;
  let textSizeDecrease = null;
  let textSizeIncrease = null;
  let container = null;

  function updateTextSizeControls() {
    if (textSizeDisplay) textSizeDisplay.textContent = `Text size: ${Math.round(textScale * 100)}%`;
    const decDisabled = textScale <= TEXT_SIZE_MIN + 1e-3;
    if (textSizeDecrease) {
      textSizeDecrease.disabled = decDisabled;
      textSizeDecrease.style.opacity = decDisabled ? "0.5" : "1";
      textSizeDecrease.style.cursor = decDisabled ? "not-allowed" : "pointer";
      textSizeDecrease.style.background = decDisabled ? "#101010" : "#151515";
    }
    const incDisabled = textScale >= TEXT_SIZE_MAX - 1e-3;
    if (textSizeIncrease) {
      textSizeIncrease.disabled = incDisabled;
      textSizeIncrease.style.opacity = incDisabled ? "0.5" : "1";
      textSizeIncrease.style.cursor = incDisabled ? "not-allowed" : "pointer";
      textSizeIncrease.style.background = incDisabled ? "#101010" : "#151515";
    }
  }

  function applyTextSize() {
    if (container) {
      container.style.fontSize = `${(textScale * 100).toFixed(2)}%`;
    }
    updateTextSizeControls();
  }

  function adjustTextScale(delta) {
    const next = clampTextScale(Math.round((textScale + delta) * 100) / 100);
    if (Math.abs(next - textScale) < 1e-4) return;
    textScale = next;
    try { localStorage.setItem(TEXT_SIZE_STORE_KEY, textScale.toString()); } catch {}
    applyTextSize();
    applyCompactModeStyles();
  }

  // Clear the page and inject our structured view
  document.documentElement.style.background = "#0b0b0b"; // dark back helps highlights stand out
  document.body.innerHTML = "";
  document.body.style.cssText = "margin:0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace; background:#0b0b0b; color:#e6e6e6;";
  applyTextSize();

  // Header info / legend
  const header = document.createElement("div");
  header.style.cssText = "position:sticky; top:0; background:#0b0b0b; padding:12px 16px; border-bottom:1px solid #222; z-index:1;";
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "X";
  closeBtn.title = "Disable extension until refresh";
  closeBtn.style.cssText = "position:absolute; top:8px; right:8px; width:28px; height:28px; line-height:28px; text-align:center; border:1px solid #333; border-radius:4px; background:#151515; color:#ccc; cursor:pointer; z-index:2147483647;";
  closeBtn.addEventListener("mouseenter", () => { closeBtn.style.background = "#1f1f1f"; });
  closeBtn.addEventListener("mouseleave", () => { closeBtn.style.background = "#151515"; });
  closeBtn.addEventListener("click", () => {
    // Navigate to same page with a one-time off flag; we strip it immediately on load
    try {
      const url = new URL(location.href);
      url.searchParams.set('fhl_off', '1');
      location.replace(url.toString());
    } catch {
      location.href = location.href + (location.search ? '&' : '?') + 'fhl_off=1';
    }
  });
  // Version label to the left of the X
  const versionLabel = document.createElement("a");
  versionLabel.href = "https://github.com/DaylightE/Log-Highlighter/tree/main";
  versionLabel.target = "_blank";
  versionLabel.rel = "noopener noreferrer";
  versionLabel.textContent = "F-list Log Highlighter v2.8.1";
  versionLabel.style.cssText = "position:absolute; top:12px; right:44px; color:#88b3ff; font-size:12px; text-decoration:none; cursor:pointer; z-index:2;";
  versionLabel.addEventListener("mouseenter", () => { versionLabel.style.textDecoration = "underline"; });
  versionLabel.addEventListener("mouseleave", () => { versionLabel.style.textDecoration = "none"; });
  header.appendChild(versionLabel);
  header.appendChild(closeBtn);
  // Disclaimer under the version label
  try {
    const disclaimer = document.createElement("div");
    disclaimer.textContent = "Message hiding logic is not perfect, review critical info";
    disclaimer.style.cssText = "position:absolute; top:28px; right:44px; color:#9aa7bd; font-size:11px; opacity:0.9;";
    header.appendChild(disclaimer);
    const disclaimer2 = document.createElement("div");
    disclaimer2.textContent = "Messages are seperated by timestamp, users sharing logs may confuse the extension";
    disclaimer2.style.cssText = "position:absolute; top:42px; right:44px; color:#9aa7bd; font-size:11px; opacity:0.9;";
    header.appendChild(disclaimer2);
    // Links under the disclaimers: Guide | Bug reports
    const linksWrap = document.createElement("div");
    linksWrap.style.cssText = "position:absolute; top:56px; right:44px; font-size:11px; opacity:0.95; z-index:3; pointer-events:auto;";
    const guideLink = document.createElement("a");
    guideLink.href = "https://github.com/DaylightE/Log-Highlighter/blob/main/README.md";
    guideLink.target = "_blank";
    guideLink.rel = "noopener noreferrer";
    guideLink.textContent = "Guide";
    guideLink.style.cssText = "color:#88b3ff; text-decoration:none;";
    guideLink.addEventListener("mouseenter", () => { guideLink.style.textDecoration = "underline"; });
    guideLink.addEventListener("mouseleave", () => { guideLink.style.textDecoration = "none"; });
    const sep = document.createTextNode(" | ");
    const bugsLink = document.createElement("a");
    bugsLink.href = "https://github.com/DaylightE/Log-Highlighter/issues";
    bugsLink.target = "_blank";
    bugsLink.rel = "noopener noreferrer";
    bugsLink.textContent = "Bug reports";
    bugsLink.style.cssText = "color:#88b3ff; text-decoration:none;";
    bugsLink.addEventListener("mouseenter", () => { bugsLink.style.textDecoration = "underline"; });
    bugsLink.addEventListener("mouseleave", () => { bugsLink.style.textDecoration = "none"; });
    linksWrap.appendChild(guideLink);
    linksWrap.appendChild(sep);
    linksWrap.appendChild(bugsLink);
    header.appendChild(linksWrap);
  } catch {}
  // Top-middle prev/next nav based on ?log= param, styled like header buttons
  try {
    const u = new URL(location.href);
    const logStr = u.searchParams.get('log');
    const logNum = logStr ? parseInt(logStr, 10) : NaN;
    if (!isNaN(logNum)) {
      const navWrap = document.createElement('div');
      navWrap.style.cssText = "position:absolute; top:8px; left:50%; transform:translateX(-50%); display:flex; gap:8px; align-items:center; z-index:2;";
      function makeNavBtn(label, title, onClick) {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.title = title;
        btn.style.cssText = "padding:4px 8px; border:1px solid #333; border-radius:4px; background:#151515; color:#ccc; cursor:pointer; font-weight:bold;";
        btn.addEventListener('mouseenter', () => { btn.style.background = '#1f1f1f'; });
        btn.addEventListener('mouseleave', () => { btn.style.background = '#151515'; });
        btn.addEventListener('click', onClick);
        return btn;
      }
      function goToLog(to) {
        return () => {
          try {
            const newUrl = new URL(location.href);
            newUrl.searchParams.set('log', String(to));
            location.assign(newUrl.toString());
          } catch {
            location.assign(`?log=${to}`);
          }
        };
      }
      const prevB = makeNavBtn('<', `Previous report (${logNum - 1})`, goToLog(logNum - 1));
      const nextB = makeNavBtn('>', `Next report (${logNum + 1})`, goToLog(logNum + 1));
      navWrap.appendChild(prevB);
      navWrap.appendChild(nextB);
      if (latestReportUrl) {
        const latestB = makeNavBtn('>>', 'Most recent report', () => location.assign(latestReportUrl));
        navWrap.appendChild(latestB);
      }
      header.appendChild(navWrap);
    }
  } catch {}
  const meta = document.createElement("div");
  meta.style.opacity = "0.92";
  meta.style.cssText += "; display:flex; flex-direction:column; gap:8px; align-items:flex-start;";
  const metaLeft = document.createElement("div");
  // Helper to build a profile link for a name
  function makeProfileLink(name) {
    const a = document.createElement("a");
    a.href = `https://www.f-list.net/c/${encodeURIComponent(name)}`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = name;
    a.style.color = "#88b3ff";
    a.style.textDecoration = "none";
    a.addEventListener("mouseenter", () => { a.style.textDecoration = "underline"; });
    a.addEventListener("mouseleave", () => { a.style.textDecoration = "none"; });
    return a;
  }
  function appendNameRow(label, name) {
    const row = document.createElement("div");
    const lab = document.createElement("span");
    lab.textContent = `${label}: `;
    const strong = document.createElement("strong");
    if (name && name.trim()) {
      strong.appendChild(makeProfileLink(name.trim()));
    } else {
      strong.textContent = "";
    }
    row.appendChild(lab);
    row.appendChild(strong);
    metaLeft.appendChild(row);
    return { row, strong };
  }
  function appendValueRow(label, value) {
    const row = document.createElement("div");
    const lab = document.createElement("span");
    lab.textContent = `${label}: `;
    const strong = document.createElement("strong");
    strong.textContent = value ?? "(unknown)";
    row.appendChild(lab);
    row.appendChild(strong);
    metaLeft.appendChild(row);
    return { row, strong };
  }
  const submittedByRow = appendNameRow("Log submitted by", submittedBy);
  // Row for 'Log submitted on' (converted to local automatically)
  const { strong: submittedOnStrong } = appendValueRow("Log submitted on", submittedOn);
  const reportingUserRow = appendNameRow("Reporting user", reportingUser);
  // Prefix star if tab slug in parentheses matches the allowlist
  let tabDisplay = tabName;
  const tabSlug = extractParenSlug(tabName);
  if (tabSlug && STAR_TAB_SLUGS.has(canonSlug(tabSlug))) tabDisplay = `\u2605${tabName}`; // U+2605 (star)
  appendValueRow("Tab", tabDisplay);
  
  // Gender extraction from profile pages
  const ALLOWED_GENDERS = [
    "None","Female","Male","Herm","Male-Herm","Shemale","Cunt-Boy","Transgender"
  ];
  const GENDER_COLORS = {
    "None":        "#9aa0a6", // Grey
    "Female":      "#ff66b3", // Pink
    // Male uses the current default link color (set dynamically)
    "Herm":        "#7913dfff", // Dark Purple
    "Male-Herm":   "#1f4b99", // Dark Blue
    "Shemale":     "#b38bfa", // Light Purple
    "Cunt-Boy":    "#3fb950", // Green
    "Transgender": "#ff9800"  // Orange
  };
  function canonicalizeGender(raw) {
    if (!raw) return null;
    const lc = String(raw).trim().toLowerCase();
    for (const g of ALLOWED_GENDERS) {
      if (g.toLowerCase() === lc) return g;
    }
    return null;
  }
  function parseGenderFromHtml(html) {
    // Try DOM-based parsing first to handle: <span class="taglabel">Gender</span>: Female<br/>
    try {
      const doc = new DOMParser().parseFromString(String(html), 'text/html');
      const spans = doc.querySelectorAll('span.taglabel');
      for (const sp of spans) {
        const label = (sp.textContent || '').trim().toLowerCase();
        if (label === 'gender') {
          // Collect following sibling text up to <br> or next label
          let text = '';
          let node = sp.nextSibling;
          while (node) {
            if (node.nodeType === 1) { // element
              const el = node;
              if (el.tagName && el.tagName.toLowerCase() === 'br') break;
              if (el.classList && el.classList.contains('taglabel')) break;
              text += ' ' + (el.textContent || '');
            } else if (node.nodeType === 3) { // text
              text += node.textContent || '';
            }
            node = node.nextSibling;
          }
          const cleaned = (text || '').replace(/^[^A-Za-z]*:/, '').trim();
          const canon = canonicalizeGender(cleaned);
          if (canon) return canon;
        }
      }
    } catch {}
    // Fallback regex directly on HTML
    try {
      const m = String(html).match(/<span[^>]*class=[^>]*taglabel[^>]*>\s*Gender\s*<\/span>\s*:\s*([^<]+)/i);
      if (m && m[1]) {
        const cleaned = m[1].trim();
        const canon = canonicalizeGender(cleaned);
        if (canon) return canon;
      }
    } catch {}
    // Text fallback if tags were stripped
    try {
      const plain = String(html).replace(/<[^>]+>/g, ' ');
      const m2 = plain.match(/\bGender\b\s*:\s*(None|Female|Male|Herm|Male-Herm|Shemale|Cunt-Boy|Transgender)\b/i);
      if (m2) return canonicalizeGender(m2[1]) || m2[1].trim();
    } catch {}
    return null;
  }
  function fetchGenderForName(name) {
    if (!name || !name.trim()) return Promise.resolve(null);
    const url = `https://www.f-list.net/c/${encodeURIComponent(name.trim())}`;
    return fetch(url, { credentials: 'include' })
      .then(r => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(html => parseGenderFromHtml(html))
      .catch(() => null);
  }

  // Ignore-evasion check helpers. Data from staff pages stays in this function scope and
  // is discarded as soon as the check is complete.
  const FHL_SITE_ORIGIN = "https://www.f-list.net";
  const FHL_IGNORE_EVASION_ANNOUNCEMENT_KEY = "fchatHighlighterIgnoreEvasionAnnouncementShown";
  const FHL_IGNORE_EVASION_ANNOUNCEMENT_END = new Date(2026, 9, 2);
  const FHL_SHOW_DIAGNOSTICS_EVENT = "fhl-show-diagnostics";
  const FHL_DIAGNOSTICS_VISIBLE_ATTRIBUTE = "data-fhl-diagnostics-visible";

  function fhlDiagnosticsVisible() {
    return document.documentElement?.getAttribute(FHL_DIAGNOSTICS_VISIBLE_ATTRIBUTE) === "true";
  }

  document.addEventListener(FHL_SHOW_DIAGNOSTICS_EVENT, () => {
    document.documentElement?.setAttribute(FHL_DIAGNOSTICS_VISIBLE_ATTRIBUTE, "true");
    for (const details of document.querySelectorAll("[data-fhl-diagnostics]")) {
      details.hidden = false;
      details.open = true;
    }
    try { console.info("[FHL] Diagnostics are now visible for this page."); } catch {}
  });

  function fhlCanonicalName(name) {
    try {
      return String(name || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
    } catch {
      return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
    }
  }

  function fhlProfileUrl(name) {
    return `${FHL_SITE_ORIGIN}/c/${encodeURIComponent(String(name || "").trim())}`;
  }

  function fhlStripUserTags(value) {
    return String(value || "").replace(/\[\/?user(?:=[^\]]*)?\]/gi, "");
  }

  function fhlLookupCharacterValue(character) {
    if (character && typeof character === "object") {
      for (const field of ["name", "character_name", "character", "title", "url", "href"]) {
        if (character[field]) return String(character[field]);
      }
      return "";
    }
    return String(character || "");
  }

  function fhlCharacterNameFromValue(value) {
    let text = fhlLookupCharacterValue(value).trim();
    try {
      const url = new URL(text, FHL_SITE_ORIGIN);
      const match = url.pathname.match(/^\/c\/([^/]+)/i);
      if (match) text = match[1];
    } catch {}
    text = text.replace(/^\/?c\//i, "").replace(/\/$/, "").replace(/\+/g, " ");
    // Lookup results can be URL-encoded more than once, while ignore-list links
    // are normally decoded once by the browser. Normalize both representations.
    for (let pass = 0; pass < 3; pass++) {
      try {
        const decoded = decodeURIComponent(text);
        if (decoded === text) break;
        text = decoded;
      } catch { break; }
    }
    return fhlStripUserTags(text).trim();
  }

  function fhlComparableCharacterName(value) {
    return fhlCanonicalName(fhlCharacterNameFromValue(value))
      .replace(/[\u2010-\u2015\u2212]/g, "-")
      .replace(/\s+/g, " ");
  }

  function fhlLooseCharacterKey(value) {
    return fhlComparableCharacterName(value).replace(/[^a-z0-9]/g, "");
  }

  function fhlAdminNoteUrl(name) {
    // F-List staff-note character lookups use the lower-case character name with spaces.
    // The browser will encode the spaces for the HTTP request as required by URL syntax.
    return `${FHL_SITE_ORIGIN}/panel/adminnote.php?character=${String(name || "").trim().toLocaleLowerCase()}`;
  }

  function fhlParseDocument(html) {
    return new DOMParser().parseFromString(String(html || ""), "text/html");
  }

  function fhlGetPasswordForm(doc) {
    const passwordForms = Array.from(doc.querySelectorAll("form")).filter(form => form.querySelector('input[type="password"]'));
    // The site header also contains a login form. Prefer the page-level challenge,
    // which preserves the return URL for the requested staff page.
    return passwordForms.find(form => form.querySelector('input[name="returnto"]')) || passwordForms[0] || null;
  }

  function fhlTrace(trace, message) {
    if (Array.isArray(trace)) trace.push(`${String(trace.length + 1).padStart(2, "0")}. ${message}`);
  }

  function fhlTraceNameList(trace, label, characters) {
    if (!Array.isArray(trace)) return;
    const names = (characters || []).map(character => String(character?.name || "").trim()).filter(Boolean);
    fhlTrace(trace, `${label}: ${names.length} name${names.length === 1 ? "" : "s"} saved.\n${names.map((name, index) => `    ${index + 1}. ${name}`).join("\n") || "    (none)"}`);
  }

  function fhlTraceUrl(url) {
    try {
      const parsed = new URL(url);
      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return String(url || "");
    }
  }

  function fhlRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      const browserRuntime = globalThis.browser?.runtime;
      const runtime = browserRuntime || globalThis.chrome?.runtime;
      if (!runtime?.sendMessage) {
        reject(new Error("The extension cannot open the F-List sign-in tab."));
        return;
      }
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      try {
        const result = browserRuntime
          ? runtime.sendMessage(message)
          : runtime.sendMessage(message, response => {
            const lastError = globalThis.chrome?.runtime?.lastError;
            if (lastError) finish(reject, new Error(lastError.message));
            else finish(resolve, response);
          });
        if (result && typeof result.then === "function") result.then(response => finish(resolve, response), error => finish(reject, error));
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  function fhlDelay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  async function fhlAuthenticateInNewTab(url, trace, label) {
    fhlTrace(trace, `${label || "F-List page"}: authentication is required; opening the requested page in a new tab.`);
    const opened = await fhlRuntimeMessage({ type: "fhl-auth-tab", action: "open", url });
    if (!opened?.tabId) throw new Error(opened?.error || "The F-List sign-in tab could not be opened.");
    const deadline = Date.now() + 15 * 60 * 1000;
    while (Date.now() < deadline) {
      await fhlDelay(1000);
      try {
        const response = await fetch(url, { credentials: "include" });
        if (response.status === 401) continue;
        if (!response.ok) throw new Error(`F-List returned HTTP ${response.status} while waiting for sign-in.`);
        const html = await response.text();
        if (fhlGetPasswordForm(fhlParseDocument(html))) continue;
        await fhlRuntimeMessage({ type: "fhl-auth-tab", action: "close", tabId: opened.tabId, returnTabId: opened.sourceTabId });
        fhlTrace(trace, `${label || "F-List page"}: sign-in completed; authentication tab closed and check resumed.`);
        return html;
      } catch (error) {
        if (error instanceof Error && /^F-List returned HTTP/.test(error.message)) throw error;
      }
    }
    throw new Error("F-List sign-in was not completed within 15 minutes. The sign-in tab has been left open.");
  }

  async function fhlFetchStaffHtml(url, trace, label) {
    fhlTrace(trace, `${label || "F-List page"}: requesting ${fhlTraceUrl(url)}.`);
    let response = await fetch(url, { credentials: "include" });
    fhlTrace(trace, `${label || "F-List page"}: received HTTP ${response.status} from ${fhlTraceUrl(response.url || url)}.`);
    if (response.status === 401) return fhlAuthenticateInNewTab(url, trace, label);
    if (!response.ok) throw new Error(`F-List returned HTTP ${response.status}.`);
    let html = await response.text();
    let doc = fhlParseDocument(html);
    fhlTrace(trace, `${label || "F-List page"}: parsed ${html.length} HTML character${html.length === 1 ? "" : "s"}; title=${JSON.stringify((doc.title || "").trim() || "(none)")}; #Content=${doc.querySelector("#Content") ? "present" : "missing"}.`);
    const passwordForm = fhlGetPasswordForm(doc);
    if (!passwordForm) {
      fhlTrace(trace, `${label || "F-List page"}: no password form detected.`);
      return html;
    }

    return fhlAuthenticateInNewTab(url, trace, label);
  }

  function fhlIgnoreEntriesIn(container) {
    if (!container) return [];
    const found = new Map();
    const add = (name, href) => {
      const cleanedName = fhlStripUserTags(name).replace(/^\s*[•·-]\s*/, "").trim();
      const key = fhlCanonicalName(cleanedName);
      const profileHref = href && /\/c\//i.test(href) ? href : null;
      if (key && !found.has(key)) found.set(key, {
        name: cleanedName,
        href: profileHref || fhlProfileUrl(cleanedName),
        comparisonValue: profileHref || cleanedName
      });
    };
    for (const link of container.querySelectorAll('a[href]')) {
      let linkUrl;
      try { linkUrl = new URL(link.getAttribute("href"), FHL_SITE_ORIGIN).toString(); } catch {}
      const name = (link.textContent || "").trim();
      add(name, linkUrl);
    }
    if (found.size) return Array.from(found.values());

    // F-List has used both links and plain text rows for this list. Keep the
    // line-oriented fallback restricted to the ignore-list container.
    const rowsHtml = (container.innerHTML || "")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(?:div|li|p|tr|td)\s*>/gi, "\n");
    const text = fhlParseDocument(rowsHtml).body.textContent || "";
    for (const row of text.split(/\r?\n/)) {
      const name = row.trim();
      if (!name || /this\s+user\s+is\s+ignoring/i.test(name) || name.length > 120) continue;
      add(name);
    }
    return Array.from(found.values());
  }

  function fhlExtractIgnoredCharacters(html) {
    const source = String(html || "");
    const ignoreHeading = /this\s+user\s+is\s+ignoring\b/i;
    const doc = fhlParseDocument(source);
    const heading = Array.from(doc.querySelectorAll("h1, h2, h3, h4, h5, h6")).find(element => ignoreHeading.test(element.textContent || ""));
    if (heading) {
      for (let element = heading.nextElementSibling; element; element = element.nextElementSibling) {
        const profiles = fhlIgnoreEntriesIn(element);
        if (profiles.length) return profiles;
        if (/^H[1-6]$/.test(element.tagName)) break;
      }
    }

    // Some staff pages wrap this block differently. Limit the raw section to the
    // ignore list, then parse its profile links instead of relying on sibling layout.
    const marker = source.search(ignoreHeading);
    if (marker < 0) return [];
    let section = source.slice(marker);
    const sectionEnd = section.search(/<div\b[^>]*\bid\s*=\s*["']AdminNoteBox["']|<h[1-6]\b/i);
    if (sectionEnd > 0) section = section.slice(0, sectionEnd);
    return fhlIgnoreEntriesIn(fhlParseDocument(section).body);
  }

  function fhlExtractAccountId(html) {
    const doc = fhlParseDocument(html);
    for (const label of doc.querySelectorAll(".label")) {
      if (/^account\s*id$/i.test((label.textContent || "").trim())) {
        const match = (label.nextElementSibling?.textContent || "").match(/\d+/);
        if (match) return match[0];
      }
    }
    const hidden = doc.querySelector('input[name="account_id"]');
    if (hidden && /^\d+$/.test(hidden.value || "")) return hidden.value;
    const link = Array.from(doc.querySelectorAll('a[href*="lookup.php?acctid="]')).find(Boolean);
    if (link) {
      try { return new URL(link.href).searchParams.get("acctid") || null; } catch {}
    }
    const fallback = (doc.body?.textContent || "").match(/account\s*id\s*(?:<[^>]*>)*\s*(\d+)/i);
    return fallback ? fallback[1] : null;
  }

  function fhlExtractCsrfToken(html) {
    const doc = fhlParseDocument(html);
    return doc.querySelector('meta[name="csrf-token"], meta#flcsrf-token')?.getAttribute("content")
      || doc.querySelector('input[name="csrf_token"]')?.value
      || null;
  }

  async function fhlLookupActiveCharacters(accountId, trace) {
    const lookupPage = await fhlFetchStaffHtml(`${FHL_SITE_ORIGIN}/panel/lookup.php?acctid=${encodeURIComponent(accountId)}`, trace, "Moderation-tool page");
    const csrfToken = fhlExtractCsrfToken(lookupPage);
    if (!csrfToken) throw new Error("The moderation tool did not provide its security token.");
    fhlTrace(trace, "Moderation-tool page: security token found (value not logged).");
    fhlTrace(trace, `Moderation lookup: requesting active characters for account ID ${accountId}.`);
    const response = await fetch(`${FHL_SITE_ORIGIN}/json/lookup.json`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams({ type: "aid", query: String(accountId), alts: "", csrf_token: csrfToken }).toString()
    });
    fhlTrace(trace, `Moderation lookup: received HTTP ${response.status}.`);
    if (!response.ok) throw new Error(`The moderation lookup returned HTTP ${response.status}.`);
    const data = await response.json();
    if (data?.error) throw new Error(`The moderation lookup failed: ${data.error}`);
    const account = (data?.accounts || []).find(item => String(item.account_id) === String(accountId)) || data?.accounts?.[0];
    if (!account || !Array.isArray(account.characters)) throw new Error("The moderation lookup did not return a character list.");
    const characters = account.characters
      .map(character => {
        const comparisonValue = fhlLookupCharacterValue(character);
        const name = fhlCharacterNameFromValue(comparisonValue);
        return name ? { name, href: fhlProfileUrl(name), comparisonValue } : null;
      })
      .filter(Boolean);
    fhlTrace(trace, `Moderation lookup: extracted ${characters.length} active character${characters.length === 1 ? "" : "s"}.`);
    fhlTrace(trace, `Moderation lookup: normalized active names: ${characters.map(character => JSON.stringify(character.name)).join(", ") || "(none)"}.`);
    fhlTraceNameList(trace, "Moderation lookup active characters", characters);
    return characters;
  }

  function fhlExtractAltAccountIds(html, primaryAccountId) {
    const accountIds = new Set();
    const doc = fhlParseDocument(html);
    for (const link of doc.querySelectorAll('a[href*="adminnote.php?accountid="]')) {
      try {
        const url = new URL(link.getAttribute("href"), FHL_SITE_ORIGIN);
        if (!/\/panel\/adminnote\.php$/i.test(url.pathname)) continue;
        const accountId = url.searchParams.get("accountid");
        if (/^\d+$/.test(accountId || "") && String(accountId) !== String(primaryAccountId)) accountIds.add(accountId);
      } catch {}
    }
    return Array.from(accountIds);
  }

  async function fhlLookupAltCharacters(accountId, trace) {
    const altsHtml = await fhlFetchStaffHtml(`${FHL_SITE_ORIGIN}/panel/alts.php?account=${encodeURIComponent(accountId)}`, trace, "Alt-accounts page");
    const altAccountIds = fhlExtractAltAccountIds(altsHtml, accountId);
    const characters = [];
    for (const altAccountId of altAccountIds) {
      const altCharacters = await fhlLookupActiveCharacters(altAccountId, trace);
      characters.push(...altCharacters.map(character => ({ ...character, alt: true })));
      const altStaffHtml = await fhlFetchStaffHtml(`${FHL_SITE_ORIGIN}/panel/adminnote.php?accountid=${encodeURIComponent(altAccountId)}`, trace, `Alt-account ${altAccountId} staff note`);
      const renamedCharacters = fhlExtractRenamedCharacters(altStaffHtml);
      fhlTrace(trace, `Alt-account ${altAccountId} staff note: extracted ${renamedCharacters.length} rename target${renamedCharacters.length === 1 ? "" : "s"}.`);
      characters.push(...renamedCharacters.map(character => ({ ...character, alt: true })));
      const deletedHtml = await fhlFetchStaffHtml(`${FHL_SITE_ORIGIN}/panel/deletedchars.php?accountid=${encodeURIComponent(altAccountId)}`, trace, `Alt-account ${altAccountId} deleted characters`);
      characters.push(...fhlExtractDeletedCharacters(deletedHtml, trace).map(character => ({ ...character, alt: true, deleted: true })));
    }
    return characters;
  }

  function fhlExtractRenamedCharacters(html) {
    const doc = fhlParseDocument(html);
    const content = doc.querySelector("#Content") || doc.body;
    const found = new Map();
    const addMatches = text => {
      const renamePattern = /\brenamed\s+to\s+(.{1,120}?)\s+by\s+the\s+user\s*\./gi;
      let match;
      while ((match = renamePattern.exec(String(text || "")))) {
        const name = fhlStripUserTags(match[1]).trim();
        const key = fhlCanonicalName(name);
        if (key && !found.has(key)) found.set(key, { name, href: fhlProfileUrl(name), comparisonValue: name, renamed: true });
      }
    };
    const walker = doc.createTreeWalker(content, 4); // NodeFilter.SHOW_TEXT
    let node;
    while ((node = walker.nextNode())) addMatches(node.nodeValue);
    return Array.from(found.values());
  }

  function fhlExtractDeletedCharacters(html, trace) {
    const doc = fhlParseDocument(html);
    const content = doc.querySelector("#Content") || doc.body;
    const found = new Map();
    const contentSource = doc.querySelector("#Content") ? "#Content" : "document body";
    let textNodeCount = 0;
    let characterIdNodeCount = 0;
    let rejectedCandidateCount = 0;
    fhlTrace(trace, `Deleted-character parser: scanning ${contentSource}; HTML length=${String(html || "").length}; title=${JSON.stringify((doc.title || "").trim() || "(none)")}.`);
    const walker = doc.createTreeWalker(content, 4); // NodeFilter.SHOW_TEXT
    let node;
    while ((node = walker.nextNode())) {
      const rawText = node.nodeValue || "";
      if (!rawText.trim()) continue;
      textNodeCount++;
      const mentionsCharacterId = /character\s+id/i.test(rawText);
      if (mentionsCharacterId) characterIdNodeCount++;
      const match = rawText.match(/^\s*(.+?),\s*character\s+id\s+\d+\s*,\s*$/i);
      if (!match && mentionsCharacterId) {
        rejectedCandidateCount++;
        fhlTrace(trace, `Deleted-character parser: rejected character-ID text node because it did not match "name, character ID number," exactly: ${JSON.stringify(rawText.trim().slice(0, 500))}.`);
      }
      if (!match) continue;
      const name = fhlStripUserTags(match[1]).trim();
      const key = fhlCanonicalName(name);
      if (!key) {
        rejectedCandidateCount++;
        fhlTrace(trace, `Deleted-character parser: rejected an exact row because its extracted name was empty; row=${JSON.stringify(rawText.trim().slice(0, 500))}.`);
      } else if (found.has(key)) {
        fhlTrace(trace, `Deleted-character parser: ignored duplicate normalized name ${JSON.stringify(name)} (key=${JSON.stringify(key)}).`);
      } else {
        found.set(key, { name, href: fhlProfileUrl(name), comparisonValue: name });
        fhlTrace(trace, `Deleted-character parser: accepted ${JSON.stringify(name)} (key=${JSON.stringify(key)}).`);
      }
    }
    if (!characterIdNodeCount) {
      const combinedPreview = String(content?.textContent || "").trim().replace(/\s+/g, " ").slice(0, 2000);
      fhlTrace(trace, `Deleted-character parser: no individual text node mentioned "character ID". Combined deleted-page text preview (first 2,000 characters): ${JSON.stringify(combinedPreview || "(empty)")}.`);
    }
    fhlTrace(trace, `Deleted-character parser summary: ${textNodeCount} non-empty text node${textNodeCount === 1 ? "" : "s"}; ${characterIdNodeCount} mentioned "character ID"; ${found.size} accepted; ${rejectedCandidateCount} rejected.`);
    return Array.from(found.values());
  }

  function fhlShowIgnoreEvasionResult(matches, error, trace, banlist = false) {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.82); z-index:2147483647;";
    const dialog = document.createElement("div");
    dialog.style.cssText = "width:min(520px, calc(100vw - 32px)); max-height:calc(100vh - 64px); overflow:auto; padding:18px; border:1px solid #444; border-radius:8px; background:#000; color:#e6e6e6; box-shadow:0 18px 45px rgba(0,0,0,.65); font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;";
    const heading = document.createElement("div");
    heading.style.cssText = "font-weight:bold; margin-bottom:10px;";
    if (error) {
      heading.textContent = banlist ? "Banlist comparison could not finish" : "Ignore-evasion check could not finish";
      const details = document.createElement("div");
      details.textContent = error;
      details.style.cssText = "color:#ffb4b4; font-size:13px; line-height:1.4;";
      dialog.append(heading, details);
    } else if (!matches.length) {
      heading.textContent = banlist ? "No matches on banlist" : "No matches on ignore list";
      dialog.appendChild(heading);
    } else {
      heading.textContent = banlist ? "Reported user's characters on banlist:" : "Reported user's characters on reporter's ignore list:";
      const list = document.createElement("div");
      list.style.cssText = "line-height:1.65;";
      for (const match of matches) {
        const item = document.createElement("div");
        const link = document.createElement("a");
        link.href = match.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = match.name;
        link.style.cssText = "color:#88b3ff;";
        item.appendChild(link);
        if (match.deleted) item.appendChild(document.createTextNode(" (deleted)"));
        if (match.alt) item.appendChild(document.createTextNode(" (alt account)"));
        if (match.renamed) item.appendChild(document.createTextNode(" (renamed)"));
        list.appendChild(item);
      }
      dialog.append(heading, list);
    }
    const disclaimer = document.createElement("div");
    disclaimer.textContent = banlist ? "Checking characters, renames and deleted characters on the reported account and all linked alt accounts." : "Checking characters, renames and deleted characters on all linked accounts. Not checking reporter's alt accounts.";
    disclaimer.style.cssText = "margin-top:16px; color:#9aa7bd; font-size:11px; line-height:1.35;";
    dialog.appendChild(disclaimer);
    const traceEntries = Array.isArray(trace) ? trace : [];
    const traceDetails = document.createElement("details");
    traceDetails.setAttribute("data-fhl-diagnostics", "");
    traceDetails.hidden = !fhlDiagnosticsVisible();
    traceDetails.open = fhlDiagnosticsVisible();
    traceDetails.style.cssText = "margin-top:14px; border-top:1px solid #252525; padding-top:10px;";
    const traceSummary = document.createElement("summary");
    traceSummary.textContent = `Diagnostic log (${traceEntries.length} entries)`;
    traceSummary.style.cssText = "cursor:pointer; color:#a9c4f5; font-size:12px;";
    const traceWarning = document.createElement("div");
    traceWarning.textContent = "This log can contain character names and account IDs. Review it before sharing.";
    traceWarning.style.cssText = "margin:8px 0; color:#d6b77a; font-size:11px; line-height:1.35;";
    const traceText = traceEntries.join("\n");
    const tracePre = document.createElement("pre");
    tracePre.textContent = traceText || "No diagnostic entries were recorded.";
    tracePre.style.cssText = "max-height:280px; overflow:auto; margin:0; padding:9px; border:1px solid #292929; border-radius:4px; background:#090909; color:#c9d1d9; white-space:pre-wrap; overflow-wrap:anywhere; user-select:text; font:11px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;";
    const copyTrace = document.createElement("button");
    copyTrace.type = "button";
    copyTrace.textContent = "Copy diagnostic log";
    copyTrace.style.cssText = "display:block; margin:8px 0 0 auto; padding:4px 7px; border:1px solid #42516d; border-radius:4px; background:#151515; color:#dce7fb; cursor:pointer; font-size:11px;";
    copyTrace.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(traceText);
        copyTrace.textContent = "Copied";
      } catch {
        copyTrace.textContent = "Copy failed — select the log text";
      }
    });
    traceDetails.append(traceSummary, traceWarning, tracePre, copyTrace);
    dialog.appendChild(traceDetails);
    const close = document.createElement("button");
    close.textContent = "Close";
    close.style.cssText = "display:block; margin:16px 0 0 auto; padding:6px 10px; border:1px solid #42516d; border-radius:4px; background:#151515; color:#e6e6e6; cursor:pointer;";
    const dismiss = () => overlay.remove();
    close.addEventListener("click", dismiss);
    overlay.addEventListener("mousedown", event => { if (event.target === overlay) dismiss(); });
    dialog.appendChild(close);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }

  function fhlShowIgnoreEvasionAnnouncement(button) {
    if (Date.now() >= FHL_IGNORE_EVASION_ANNOUNCEMENT_END.getTime()) return;
    try {
      if (localStorage.getItem(FHL_IGNORE_EVASION_ANNOUNCEMENT_KEY) === "1") return;
      // Record it when it is shown, so it can never be displayed more than once.
      localStorage.setItem(FHL_IGNORE_EVASION_ANNOUNCEMENT_KEY, "1");
    } catch {}

    const bubble = document.createElement("div");
    bubble.setAttribute("role", "status");
    bubble.style.cssText = "position:fixed; z-index:2147483647; box-sizing:border-box; width:min(390px, calc(100vw - 24px)); padding:14px; border:1px solid #64748b; border-radius:8px; background:#171717; color:#f2f5fa; box-shadow:0 12px 32px rgba(0,0,0,.6); font:13px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;";
    const message = document.createElement("div");
    message.textContent = "New feature! Is opening up 4 different tabs to confirm an ignore evasion tedious? Well, labour no more! Introducing 1 click ignore evasion checking, including checking deleted characters and alt accounts! Rejoice!";
    const praise = document.createElement("button");
    praise.type = "button";
    praise.textContent = "Praise Ariana";
    praise.style.cssText = "display:block; margin:12px 0 0 auto; padding:6px 10px; border:1px solid #668ee6; border-radius:4px; background:#284b88; color:#fff; cursor:pointer; font:inherit;";
    const arrow = document.createElement("div");
    arrow.setAttribute("aria-hidden", "true");
    arrow.style.cssText = "position:absolute; width:0; height:0; border-left:9px solid transparent; border-right:9px solid transparent;";
    bubble.append(message, praise, arrow);

    let dismissed = false;
    const position = () => {
      if (dismissed || !button.isConnected || !bubble.isConnected) return;
      const buttonBox = button.getBoundingClientRect();
      const padding = 12;
      const bubbleWidth = bubble.offsetWidth;
      const left = Math.max(padding, Math.min(buttonBox.left + (buttonBox.width / 2) - (bubbleWidth / 2), window.innerWidth - bubbleWidth - padding));
      const topAbove = buttonBox.top - bubble.offsetHeight - 14;
      const above = topAbove >= padding;
      const top = above ? topAbove : Math.min(buttonBox.bottom + 14, Math.max(padding, window.innerHeight - bubble.offsetHeight - padding));
      const arrowLeft = Math.max(9, Math.min(buttonBox.left + (buttonBox.width / 2) - left - 9, bubbleWidth - 27));
      bubble.style.left = `${left}px`;
      bubble.style.top = `${top}px`;
      arrow.style.left = `${arrowLeft}px`;
      if (above) {
        arrow.style.top = "auto";
        arrow.style.bottom = "-9px";
        arrow.style.borderTop = "9px solid #171717";
        arrow.style.borderBottom = "0";
      } else {
        arrow.style.top = "-9px";
        arrow.style.bottom = "auto";
        arrow.style.borderTop = "0";
        arrow.style.borderBottom = "9px solid #171717";
      }
    };
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      window.removeEventListener("resize", position);
      bubble.remove();
    };
    praise.addEventListener("click", dismiss);
    document.body.appendChild(bubble);
    position();
    window.addEventListener("resize", position);
    requestAnimationFrame(position);
  }

  async function fhlCheckIgnoreEvasion(submitterName, reportedName, trace) {
    fhlTrace(trace, "Ignore-evasion check started.");
    fhlTrace(trace, `Log metadata: submitter="${submitterName || "(missing)"}", reported user="${reportedName || "(missing)"}".`);
    if (!submitterName || !reportedName) throw new Error("The log is missing the submitter or reported-user name.");
    const ignoredHtml = await fhlFetchStaffHtml(fhlAdminNoteUrl(submitterName), trace, "Submitter staff note");
    const ignoredCharacters = fhlExtractIgnoredCharacters(ignoredHtml);
    fhlTrace(trace, `Submitter staff note: extracted ${ignoredCharacters.length} ignored character${ignoredCharacters.length === 1 ? "" : "s"}.`);
    fhlTraceNameList(trace, "Submitter ignore list", ignoredCharacters);
    if (!ignoredCharacters.length) throw new Error(`No ignore list was found on the staff note for "${submitterName}".`);

    return fhlCompareCharacters(ignoredCharacters, reportedName, trace);
  }

  function fhlParseBanlist(input) {
    // Skip the timestamp so its colon is not mistaken for the list delimiter.
    let names = String(input || "").trim().replace(/^\[[^\]]*\]\s*/, "");
    const delimiter = names.indexOf(":");
    if (delimiter !== -1) names = names.slice(delimiter + 1);
    const unique = new Map();
    for (const entry of names.split(",")) {
      const name = entry.trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2").trim();
      const key = fhlComparableCharacterName(name);
      if (key && !unique.has(key)) unique.set(key, { name, comparisonValue: name });
    }
    return Array.from(unique.values());
  }

  async function fhlCompareCharacters(ignoredCharacters, reportedName, trace) {
    if (!reportedName) throw new Error("The log is missing the reported-user name.");
    const reportedHtml = await fhlFetchStaffHtml(fhlAdminNoteUrl(reportedName), trace, "Reported-user staff note");
    const accountId = fhlExtractAccountId(reportedHtml);
    fhlTrace(trace, accountId ? `Reported-user staff note: account ID ${accountId} extracted.` : "Reported-user staff note: account ID was not found.");
    if (!accountId) throw new Error("The reported user's account ID was not found in their staff note.");

    const activeCharacters = await fhlLookupActiveCharacters(accountId, trace);
    const altCharacters = await fhlLookupAltCharacters(accountId, trace);
    const renamedCharacters = fhlExtractRenamedCharacters(reportedHtml);
    fhlTrace(trace, `Reported-user staff note: extracted ${renamedCharacters.length} rename target${renamedCharacters.length === 1 ? "" : "s"}.`);
    const deletedHtml = await fhlFetchStaffHtml(`${FHL_SITE_ORIGIN}/panel/deletedchars.php?accountid=${encodeURIComponent(accountId)}`, trace, "Deleted-characters page");
    const deletedCharacters = fhlExtractDeletedCharacters(deletedHtml, trace).map(character => ({ ...character, deleted: true }));
    fhlTrace(trace, `Deleted-characters page: extracted ${deletedCharacters.length} deleted character${deletedCharacters.length === 1 ? "" : "s"}.`);
    const allCharacters = [...activeCharacters, ...deletedCharacters, ...renamedCharacters, ...altCharacters];
    fhlTraceNameList(trace, "Deleted characters", deletedCharacters);
    fhlTraceNameList(trace, "Reported-account rename targets", renamedCharacters);
    fhlTraceNameList(trace, "All reported-account characters", allCharacters);
    fhlTrace(trace, `Comparison input: ${ignoredCharacters.length} comparison name${ignoredCharacters.length === 1 ? "" : "s"}; ${allCharacters.length} active/deleted/renamed character name${allCharacters.length === 1 ? "" : "s"}.`);
    const ignoredByName = new Set(ignoredCharacters.map(character => fhlComparableCharacterName(character.comparisonValue || character.name)));
    const ignoredDisplayNames = new Set(ignoredCharacters.map(character => fhlCanonicalName(character.name)));
    const ignoredLooseNames = new Set(ignoredCharacters.map(character => fhlLooseCharacterKey(character.comparisonValue || character.name)));
    const matches = [];
    const seen = new Map();
    for (const character of allCharacters) {
      const key = fhlComparableCharacterName(character.comparisonValue || character.name);
      const displayKey = fhlCanonicalName(character.name);
      const looseKey = fhlLooseCharacterKey(character.comparisonValue || character.name);
      const matchType = ignoredByName.has(key) ? "canonical profile/name" : ignoredDisplayNames.has(displayKey) ? "display name" : ignoredLooseNames.has(looseKey) ? "separator-insensitive" : null;
      fhlTrace(trace, `Comparison candidate: ${JSON.stringify(character.name)}; canonical=${JSON.stringify(key)}; loose=${JSON.stringify(looseKey)}; ${matchType ? `matched by ${matchType}` : "no match"}.`);
      if (matchType) {
        const existing = seen.get(key);
        if (existing) {
          for (const flag of ["deleted", "alt", "renamed"]) {
            if (character[flag]) existing[flag] = true;
          }
        } else {
          const match = { ...character };
          seen.set(key, match);
          matches.push(match);
        }
      }
    }
    fhlTrace(trace, `Comparison complete: ${matches.length} matching character${matches.length === 1 ? "" : "s"}.`);
    return matches;
  }

  // Before gender loads, color names grey
  function presetGrey(rowObj) {
    if (!rowObj) return;
    const link = rowObj.strong.querySelector('a');
    const target = link || rowObj.strong;
    try {
      // Capture current default color once
      if (link && !link.dataset.defaultColor) {
        const cs = getComputedStyle(link);
        link.dataset.defaultColor = (cs && cs.color) ? cs.color : (link.style.color || "");
      }
    } catch {}
    target.style.color = "#9aa0a6"; // grey while loading
  }
  // Apply color to the name link based on gender
  function colorizeName(rowObj, gender) {
    if (!rowObj || !gender) return;
    const g = canonicalizeGender(gender);
    if (!g) return;
    let color = GENDER_COLORS[g];
    const link = rowObj.strong.querySelector('a');
    const target = link || rowObj.strong;
    if (g === "Male") {
      // Restore the element's original/default link color
      const def = (link && link.dataset && link.dataset.defaultColor) ? link.dataset.defaultColor : "#88b3ff";
      target.style.color = def;
    } else if (color) {
      target.style.color = color;
    }
    try { target.title = `Gender: ${g}`; } catch {}
  }
  // Fetch and color in parallel (silently ignore failures)
  presetGrey(submittedByRow);
  presetGrey(reportingUserRow);
  fetchGenderForName(submittedBy || "").then(g => { if (g) colorizeName(submittedByRow, g); });
  fetchGenderForName(reportingUser || "").then(g => { if (g) colorizeName(reportingUserRow, g); });
  const reportDiv = document.createElement("div");
  const reportLabel = document.createElement("span");
  reportLabel.textContent = "Report text: ";
  const reportVal = document.createElement("span");
  reportVal.style.whiteSpace = "pre-wrap";
  reportVal.textContent = reportText ?? "";
  reportDiv.appendChild(reportLabel);
  reportDiv.appendChild(reportVal);
  metaLeft.appendChild(reportDiv);
  const legend = document.createElement("div");
  legend.style.cssText = "display:flex; gap:12px; align-items:center; width:100%;";
  legend.appendChild(makeLegendItem(COLOR_REPORT, "Reported user", 'report'));
  legend.appendChild(makeLegendItem(COLOR_SUBMIT, "Log submitted by", 'submit'));
  legend.appendChild(makeLegendItem(COLOR_EXTRA, "Additional", 'extra'));
  const extraWrap = document.createElement("div");
  extraWrap.style.cssText = "display:flex; align-items:center; gap:8px; width:100%;";
  const extraLabel = document.createElement("label");
  extraLabel.textContent = "Additional names:";
  extraLabel.style.cssText = "opacity:0.9;";
  const extraInput = document.createElement("input");
  extraInput.type = "text";
  extraInput.placeholder = "Comma-separated";
  extraInput.style.cssText = "padding:6px 8px; border-radius:4px; border:1px solid #333; background:#111; color:#e6e6e6; min-width:280px;";
  extraWrap.appendChild(extraLabel);
  extraWrap.appendChild(extraInput);
  // Navigation buttons to jump between highlighted messages
  const navBtnUp = document.createElement("button");
  navBtnUp.textContent = "\u25B2"; // U+25B2 (up triangle)
  navBtnUp.title = "Previous highlighted message";
  navBtnUp.style.cssText = "padding:4px 8px; border:1px solid #333; border-radius:4px; background:#151515; color:#ccc; cursor:pointer;";
  navBtnUp.addEventListener("mouseenter", () => { navBtnUp.style.background = "#1f1f1f"; });
  navBtnUp.addEventListener("mouseleave", () => { navBtnUp.style.background = "#151515"; });
  const navBtnDown = document.createElement("button");
  navBtnDown.textContent = "\u25BC"; // U+25BC (down triangle)
  navBtnDown.title = "Next highlighted message";
  navBtnDown.style.cssText = "padding:4px 8px; border:1px solid #333; border-radius:4px; background:#151515; color:#ccc; cursor:pointer;";
  navBtnDown.addEventListener("mouseenter", () => { navBtnDown.style.background = "#1f1f1f"; });
  navBtnDown.addEventListener("mouseleave", () => { navBtnDown.style.background = "#151515"; });
  extraWrap.appendChild(navBtnUp);
  extraWrap.appendChild(navBtnDown);

    // Copy button for selected (gold-bordered) messages
    const copyBtn = document.createElement("button");
    // Build traditional icons with inline SVG for consistent rendering
    const SVG_NS = 'http://www.w3.org/2000/svg';
    function svgEl(name, attrs) {
      const el = document.createElementNS(SVG_NS, name);
      for (const k in attrs) el.setAttribute(k, attrs[k]);
      return el;
    }
    function makeClipboardIcon() {
      // Two overlapping sheets of paper (classic copy icon)
      const svg = svgEl('svg', { width: '16', height: '16', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', style: 'display:inline-block; vertical-align:middle;' });
      // Back sheet
      svg.appendChild(svgEl('rect', { x: '5', y: '3', width: '12', height: '15', rx: '2', ry: '2' }));
      // Front sheet (slightly down/right)
      svg.appendChild(svgEl('rect', { x: '7', y: '6', width: '12', height: '15', rx: '2', ry: '2' }));
      return svg;
    }
    function setCopyBtnIcon() {
      try { copyBtn.textContent = ''; } catch {}
      try { copyBtn.innerHTML = ''; } catch {}
      try { copyBtn.appendChild(makeClipboardIcon()); } catch { copyBtn.textContent = '[copy]'; }
    }
    setCopyBtnIcon();
    copyBtn.title = "Copy selected messages to clipboard. You can select messages by clicking on them in the log";
    copyBtn.style.cssText = "padding:4px 8px; border:1px solid #333; border-radius:4px; background:#151515; color:#ccc; cursor:pointer;";
    copyBtn.addEventListener("mouseenter", () => { copyBtn.style.background = "#1f1f1f"; });
    copyBtn.addEventListener("mouseleave", () => { copyBtn.style.background = "#151515"; });
  copyBtn.addEventListener('click', async () => {
    try {
      // Insert a zero-width space into the timestamp to avoid re-parsing as a new message when pasted
      const addZwsToTimestampLine = (line) => {
        if (!tsStartRe.test(line)) return line;
        const open = line.indexOf('[');
        const close = line.indexOf(']', open + 1);
        if (open === -1 || close === -1) return line;
        const ts = line.slice(open + 1, close);
        if (!ts) return line;
        const mid = Math.floor(ts.length / 2);
        const tsWithZws = `${ts.slice(0, mid)}\u200b${ts.slice(mid)}`;
        return `${line.slice(0, open + 1)}${tsWithZws}${line.slice(close)}`;
      };
      const obfuscateTimestampInBlock = (blockText) => {
        const parts = String(blockText || "").split("\n");
        if (!parts.length) return "";
        parts[0] = addZwsToTimestampLine(parts[0]);
        return parts.join("\n");
      };
      // Collect in chronological order (wrappers insertion order)
      const selected = wrappers.filter(w => w && w.wrap && w.wrap.dataset && w.wrap.dataset.fhlSelected === '1');
        if (!selected.length) {
          copyBtn.textContent = 'Nothing selected';
          setTimeout(() => { try { setCopyBtnIcon(); } catch {} }, 1200);
          return;
        }
      const text = selected.map(w => obfuscateTimestampInBlock(w.pre && w.pre.textContent ? w.pre.textContent : '')).join('\n');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-1000px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { try { setCopyBtnIcon(); } catch {} }, 1000);
    } catch (e) {
        copyBtn.textContent = 'Copy failed';
        setTimeout(() => { try { setCopyBtnIcon(); } catch {} }, 1500);
    }
  });
    extraWrap.appendChild(copyBtn);

      // Eye toggle: hide non-highlighted and non-selected messages
      let hideMode = false;
      let openHiddenRanges = [];
      // Ads toggle: hide messages not matching the ADS rule
      let adsMode = false;
      function rangeIntersects(s1, e1, s2, e2) { return s1 <= e2 && s2 <= e1; }
      function isRangeOpen(s, e) {
        for (const r of openHiddenRanges) { if (rangeIntersects(s, e, r.s, r.e)) return true; }
        return false;
      }
      // Open ranges for ADS placeholders
      let openAdsRanges = [];
      function adsIsRangeOpen(s, e) {
        for (const r of openAdsRanges) { if (rangeIntersects(s, e, r.s, r.e)) return true; }
        return false;
      }
        // openHiddenGroups replaced by openHiddenRanges above
    const hideBtn = document.createElement("button");
    // Eye icon (open/closed) via inline SVG; turns red when hiding
    function makeEyeIcon(closed) {
      const svg = svgEl('svg', { width: '18', height: '18', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', style: 'display:inline-block; vertical-align:middle;' });
      // Eye outline
      svg.appendChild(svgEl('path', { d: 'M1 12s5-7 11-7 11 7 11 7-5 7-11 7S1 12 1 12z' }));
      // Pupil
      svg.appendChild(svgEl('circle', { cx: '12', cy: '12', r: '3' }));
      if (closed) {
        svg.appendChild(svgEl('path', { d: 'M3 3L21 21' }));
      }
      return svg;
    }
    function setHideBtnLabel() {
      try { hideBtn.textContent = ''; hideBtn.innerHTML = ''; } catch {}
      hideBtn.style.color = hideMode ? "#e74c3c" : "#ccc";
      try { hideBtn.appendChild(makeEyeIcon(hideMode)); } catch { hideBtn.textContent = hideMode ? '[eye-off]' : '[eye]'; }
      hideBtn.title = hideMode ? "Show all messages" : "Show only highlighted/selected messages";
    }
    setHideBtnLabel();
    hideBtn.style.cssText = "padding:4px 8px; border:1px solid #333; border-radius:4px; background:#151515; color:#ccc; cursor:pointer;";
    hideBtn.addEventListener("mouseenter", () => { hideBtn.style.background = "#1f1f1f"; });
    hideBtn.addEventListener("mouseleave", () => { hideBtn.style.background = "#151515"; });
        hideBtn.addEventListener('click', () => {
          hideMode = !hideMode;
          if (!hideMode) {
            openHiddenRanges = [];
          } else {
            // entering hide mode: reset ads open subranges to avoid leaking ads
            try { openAdsRanges = []; } catch {}
          }
          setHideBtnLabel();
          applyVisibility();
        });
    extraWrap.appendChild(hideBtn);
    // Ads filter button (to the right of the eye)
    const adsBtn = document.createElement('button');
    function setAdsBtnLabel() {
      try { adsBtn.textContent = 'Ads'; adsBtn.innerHTML = adsBtn.textContent; } catch {}
      adsBtn.style.color = adsMode ? '#e74c3c' : '#ccc';
      adsBtn.title = adsMode ? 'Show all messages' : 'Hide unless first char is * or a name-ending ": " appears within first 22 chars. Does not hide highlighted messages';
    }
    setAdsBtnLabel();
    adsBtn.style.cssText = "padding:4px 8px; border:1px solid #333; border-radius:4px; background:#151515; color:#ccc; cursor:pointer;";
    adsBtn.addEventListener('mouseenter', () => { adsBtn.style.background = '#1f1f1f'; });
    adsBtn.addEventListener('mouseleave', () => { adsBtn.style.background = '#151515'; });
    adsBtn.addEventListener('click', () => {
      adsMode = !adsMode;
      setAdsBtnLabel();
      applyVisibility();
    });
    extraWrap.appendChild(adsBtn);
  meta.appendChild(metaLeft);
  meta.appendChild(legend);
  meta.appendChild(extraWrap);
  header.appendChild(meta);
  // Ensure the close button is the topmost child so it stays clickable
  header.appendChild(closeBtn);

  // Collapse toggle (arrow at bottom middle of header)
  const collapseBtn = document.createElement("button");
  collapseBtn.textContent = "v";
  collapseBtn.title = "Collapse header";
  // Ensure ASCII-only label to avoid encoding issues
  try { collapseBtn.textContent = "v"; } catch {}
  collapseBtn.style.cssText = "position:absolute; bottom:6px; left:50%; transform:translateX(-50%); width:28px; height:20px; line-height:18px; text-align:center; border:1px solid #333; border-radius:4px; background:#151515; color:#ccc; cursor:pointer;";
  collapseBtn.addEventListener("mouseenter", () => { collapseBtn.style.background = "#1f1f1f"; });
  collapseBtn.addEventListener("mouseleave", () => { collapseBtn.style.background = "#151515"; });
  header.appendChild(collapseBtn);
  // Text size controls (above compact mode)
  const textSizeWrap = document.createElement("div");
  textSizeWrap.style.cssText = "position:absolute; bottom:70px; right:8px; display:flex; align-items:center; gap:8px; font-size:12px; color:#ccc; user-select:none; z-index:2;";
  const textSizeDecreaseBtn = document.createElement("button");
  textSizeDecreaseBtn.textContent = "-";
  textSizeDecreaseBtn.style.cssText = "width:24px; height:22px; border:1px solid #333; border-radius:4px; background:#151515; color:#ccc; cursor:pointer;";
  textSizeDecreaseBtn.addEventListener("mouseenter", () => { if (!textSizeDecreaseBtn.disabled) textSizeDecreaseBtn.style.background = "#1f1f1f"; });
  textSizeDecreaseBtn.addEventListener("mouseleave", () => { textSizeDecreaseBtn.style.background = textSizeDecreaseBtn.disabled ? "#101010" : "#151515"; });
  const textSizeDisplaySpan = document.createElement("span");
  textSizeDisplaySpan.style.cssText = "min-width:128px; text-align:center; letter-spacing:0.4px; color:#e6e6e6;";
  const textSizeIncreaseBtn = document.createElement("button");
  textSizeIncreaseBtn.textContent = "+";
  textSizeIncreaseBtn.style.cssText = "width:24px; height:22px; border:1px solid #333; border-radius:4px; background:#151515; color:#ccc; cursor:pointer;";
  textSizeIncreaseBtn.addEventListener("mouseenter", () => { if (!textSizeIncreaseBtn.disabled) textSizeIncreaseBtn.style.background = "#1f1f1f"; });
  textSizeIncreaseBtn.addEventListener("mouseleave", () => { textSizeIncreaseBtn.style.background = textSizeIncreaseBtn.disabled ? "#101010" : "#151515"; });
  textSizeWrap.appendChild(textSizeDecreaseBtn);
  textSizeWrap.appendChild(textSizeDisplaySpan);
  textSizeWrap.appendChild(textSizeIncreaseBtn);
  header.appendChild(textSizeWrap);

  textSizeDecrease = textSizeDecreaseBtn;
  textSizeIncrease = textSizeIncreaseBtn;
  textSizeDisplay = textSizeDisplaySpan;

  textSizeDecreaseBtn.addEventListener("click", () => adjustTextScale(-TEXT_SIZE_STEP));
  textSizeIncreaseBtn.addEventListener("click", () => adjustTextScale(TEXT_SIZE_STEP));

  // Max icon counter (bottom-right)
  const compactModeLabel = document.createElement("label");
  compactModeLabel.style.cssText = "position:absolute; bottom:34px; right:8px; display:flex; align-items:center; gap:6px; padding:4px 8px; border:1px solid #333; border-radius:4px; background:#151515; color:#ccc; font-size:12px; cursor:pointer;";
  compactModeLabel.title = "Toggle compact spacing";
  const compactModeCheckbox = document.createElement("input");
  compactModeCheckbox.type = "checkbox";
  compactModeCheckbox.checked = compactMode;
  compactModeCheckbox.style.margin = "0";
  const compactModeText = document.createElement("span");
  compactModeText.textContent = "Compact mode";
  const compactModeBox = document.createElement("span");
  compactModeBox.style.cssText = "width:16px; height:16px; border:1px solid #555; border-radius:3px; background:#000; display:inline-flex; align-items:center; justify-content:center; font-size:12px; color:#f7f9fc; font-weight:bold; transition:background 0.15s ease, border-color 0.15s ease;";
  compactModeBox.setAttribute("aria-hidden", "true");
  compactModeLabel.appendChild(compactModeBox);
  compactModeLabel.appendChild(compactModeText);
  compactModeLabel.appendChild(compactModeCheckbox);
  compactModeLabel.style.position = "absolute";
  compactModeCheckbox.style.position = "absolute";
  compactModeCheckbox.style.left = "8px";
  compactModeCheckbox.style.top = "50%";
  compactModeCheckbox.style.transform = "translateY(-50%)";
  compactModeCheckbox.style.width = "16px";
  compactModeCheckbox.style.height = "16px";
  compactModeCheckbox.style.opacity = "0";
  compactModeCheckbox.style.cursor = "pointer";
  compactModeCheckbox.style.padding = "0";
  compactModeCheckbox.style.zIndex = "1";
  header.appendChild(compactModeLabel);

  const ignoreEvasionWrap = document.createElement("div");
  ignoreEvasionWrap.style.cssText = "position:absolute; bottom:6px; right:8px; display:flex; align-items:center; gap:6px;";
  const ignoreEvasionBtn = document.createElement("button");
  ignoreEvasionBtn.textContent = "Ignore evasion?";
  ignoreEvasionBtn.title = "Compare the submitter's ignore list with the reported account's active and deleted characters";
  ignoreEvasionBtn.style.cssText = "padding:2px 6px; border:1px solid #333; border-radius:4px; background:#151515; color:#ccc; font-size:12px; cursor:pointer;";
  ignoreEvasionBtn.addEventListener("mouseenter", () => { if (!ignoreEvasionBtn.disabled) ignoreEvasionBtn.style.background = "#1f1f1f"; });
  ignoreEvasionBtn.addEventListener("mouseleave", () => { ignoreEvasionBtn.style.background = ignoreEvasionBtn.disabled ? "#101010" : "#151515"; });
  ignoreEvasionBtn.addEventListener("click", async () => {
    const trace = [];
    ignoreEvasionBtn.disabled = true;
    ignoreEvasionBtn.textContent = "Checking…";
    ignoreEvasionBtn.style.cursor = "wait";
    ignoreEvasionBtn.style.opacity = "0.7";
    try {
      const matches = await fhlCheckIgnoreEvasion(submittedByRaw, reportingUserRaw, trace);
      fhlShowIgnoreEvasionResult(matches, null, trace);
    } catch (error) {
      const message = error instanceof Error ? error.message : "An unexpected error occurred.";
      fhlTrace(trace, `Check stopped with error: ${message}`);
      fhlShowIgnoreEvasionResult([], message, trace);
    } finally {
      if (fhlDiagnosticsVisible()) {
        try { console.info("[FHL] Ignore-evasion diagnostic log\n" + trace.join("\n")); } catch {}
      }
      ignoreEvasionBtn.disabled = false;
      ignoreEvasionBtn.textContent = "Ignore evasion?";
      ignoreEvasionBtn.style.cursor = "pointer";
      ignoreEvasionBtn.style.opacity = "1";
    }
  });
  const compareBanlistBtn = document.createElement("button");
  compareBanlistBtn.type = "button";
  compareBanlistBtn.textContent = "Compare banlist";
  compareBanlistBtn.title = "Compare a pasted banlist with the reported user's characters and linked alt accounts";
  compareBanlistBtn.style.cssText = ignoreEvasionBtn.style.cssText;
  compareBanlistBtn.addEventListener("click", async () => {
    const input = window.prompt("Paste the channel banlist or a comma-separated list of character names:");
    if (input === null) return;
    const trace = [];
    compareBanlistBtn.disabled = true;
    compareBanlistBtn.textContent = "Checking…";
    compareBanlistBtn.style.cursor = "wait";
    compareBanlistBtn.style.opacity = "0.7";
    try {
      const names = fhlParseBanlist(input);
      if (!names.length) throw new Error("Please enter at least one character name.");
      fhlTrace(trace, `Banlist comparison started with ${names.length} unique names.`);
      const matches = await fhlCompareCharacters(names, reportingUserRaw, trace);
      fhlShowIgnoreEvasionResult(matches, null, trace, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "An unexpected error occurred.";
      fhlTrace(trace, `Check stopped with error: ${message}`);
      fhlShowIgnoreEvasionResult([], message, trace, true);
    } finally {
      compareBanlistBtn.disabled = false;
      compareBanlistBtn.textContent = "Compare banlist";
      compareBanlistBtn.style.cursor = "pointer";
      compareBanlistBtn.style.opacity = "1";
    }
  });
  const maxIconBadge = document.createElement("div");
  maxIconBadge.style.cssText = "padding:2px 6px; border:1px solid #333; border-radius:4px; background:#151515; color:#ccc; font-size:12px;";
  maxIconBadge.textContent = `Reported max eicons: ${maxReportedIcons}`;
  ignoreEvasionWrap.append(compareBanlistBtn, ignoreEvasionBtn, maxIconBadge);
  header.appendChild(ignoreEvasionWrap);
  fhlShowIgnoreEvasionAnnouncement(ignoreEvasionBtn);

  function updateCompactModeLabelState() {
    const isOn = compactMode;
    compactModeLabel.style.borderColor = isOn ? "#4f86ff" : "#333";
    compactModeLabel.style.color = isOn ? "#e6e6e6" : "#ccc";
    compactModeBox.style.background = isOn ? "#4f86ff" : "#000";
    compactModeBox.style.borderColor = isOn ? "#4f86ff" : "#555";
    compactModeBox.textContent = isOn ? String.fromCharCode(0x2713) : "";
  }
  updateCompactModeLabelState();
  compactModeCheckbox.addEventListener("change", () => {
    compactMode = compactModeCheckbox.checked;
    try { localStorage.setItem(COMPACT_STORE_KEY, compactMode ? "1" : "0"); } catch {}
    updateCompactModeLabelState();
    applyCompactModeStyles();
    applyVisibility();
  });

  applyTextSize();

  // Restore button (shows only when header collapsed)
  const restoreBtn = document.createElement("button");
  restoreBtn.textContent = "^";
  restoreBtn.title = "Expand header";
  // Ensure ASCII-only label to avoid encoding issues
  try { restoreBtn.textContent = "^"; } catch {}
  restoreBtn.style.cssText = "position:fixed; top:2px; left:50%; transform:translateX(-50%); width:28px; height:20px; line-height:18px; text-align:center; border:1px solid #333; border-radius:4px; background:#151515; color:#ccc; cursor:pointer; display:none; z-index:2147483647;";
  restoreBtn.addEventListener("mouseenter", () => { restoreBtn.style.background = "#1f1f1f"; });
  restoreBtn.addEventListener("mouseleave", () => { restoreBtn.style.background = "#151515"; });

  collapseBtn.addEventListener("click", () => {
    header.style.display = "none";
    restoreBtn.style.display = "block";
  });
  restoreBtn.addEventListener("click", () => {
    header.style.display = "";
    restoreBtn.style.display = "none";
  });

  document.body.appendChild(header);
  document.body.appendChild(restoreBtn);

  container = document.createElement("div");
  container.style.cssText = "padding: 12px 16px; display:flex; flex-direction:column; gap:8px;";
  document.body.appendChild(container);

  // Render each message in a block with background if sender matches
  const submitName = submittedByRaw;
  const reportName = reportingUserRaw;
  const wrappers = [];

  function applyCompactModeToWrap(wrap) {
    if (!wrap) return;
    const padY = ((compactMode ? 2 : 8) * textScale).toFixed(2);
    const padX = ((compactMode ? 6 : 10) * textScale).toFixed(2);
    wrap.style.padding = `${padY}px ${padX}px`;
    wrap.style.lineHeight = compactMode ? "1.15" : "1.35";
    wrap.style.borderRadius = compactMode ? "4px" : "6px";
  }

  function stylePlaceholderElement(el) {
    if (!el) return;
    const margin = ((compactMode ? 2 : 6) * textScale).toFixed(2);
    const padY = ((compactMode ? 3 : 6) * textScale).toFixed(2);
    const padX = ((compactMode ? 5 : 8) * textScale).toFixed(2);
    el.style.margin = `${margin}px 0`;
    el.style.padding = `${padY}px ${padX}px`;
  }

  function applyCompactModeStyles() {
    if (!container) return;
    const baseGap = compactMode ? 2 : 8;
    const gapPx = (baseGap * textScale).toFixed(2);
    container.style.gap = `${gapPx}px`;
    for (const { wrap } of wrappers) {
      applyCompactModeToWrap(wrap);
    }
    const placeholders = container.querySelectorAll('[data-fhl-placeholder="1"], [data-fhl-placeholder-ads="1"]');
    placeholders.forEach(ph => stylePlaceholderElement(ph));
  }

  applyCompactModeStyles();

  for (const msg of messages) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "border-radius:6px; padding:8px 10px; white-space:pre-wrap; line-height:1.35;";
    applyCompactModeToWrap(wrap);

    const s = msg.afterNoStar || "";
    if (afterStartsWithName(s, reportName)) {
      wrap.style.background = COLOR_REPORT;
      wrap.style.border = "1px solid #400";
    } else if (afterStartsWithName(s, submitName)) {
      wrap.style.background = COLOR_SUBMIT;
      wrap.style.border = "1px solid #024";
    } else {
      wrap.style.background = "transparent";
    }

    // Preserve original text for the whole message block
    const pre = document.createElement("pre");
    pre.style.cssText = "margin:0; font: inherit; color: inherit; white-space: pre-wrap;";
    pre.textContent = msg.blockLines.join("\n");
    wrap.appendChild(pre);
    container.appendChild(wrap);
    // Click to toggle gold selection border (ignore if user is selecting text)
    const setSelected = (el, selected) => {
      try { el.dataset.fhlSelected = selected ? '1' : '0'; } catch {}
      el.style.boxShadow = selected ? '0 0 0 2px gold inset' : '';
    };
      wrap.addEventListener('click', (ev) => {
      try {
        const sel = window.getSelection && window.getSelection();
        if (sel && String(sel).length > 0) return; // don't toggle when text is selected
      } catch {}
        const isSelected = wrap.dataset && wrap.dataset.fhlSelected === '1';
        setSelected(wrap, !isSelected);
        if (hideMode) updateHiddenPlaceholders();
      });
    // Initialize as not selected
    setSelected(wrap, false);

    try {
      const adsPass = adsCheckFirst22(msg.afterWithSpaces || "");
      wrap.dataset.fhlAds = adsPass ? '1' : '0';
    } catch {}

    wrappers.push({ wrap, pre, msg, origText: pre.textContent });
  }

  applyCompactModeStyles();

    // --- Highlight navigation helpers ---
  let navList = [];
  let navIndex = -1;
  let lastFocusedWrap = null;
  function rebuildNavList() {
    navList = wrappers.filter(w => w.wrap && w.wrap.dataset && w.wrap.dataset.fhlHi === '1');
    if (!navList.length) { navIndex = -1; return; }

    // If we have a previously focused item and it's still highlighted, keep index
    if (lastFocusedWrap) {
      const idx = navList.findIndex(w => w.wrap === lastFocusedWrap);
      if (idx !== -1) { navIndex = idx; return; }
    }

    // Otherwise, pick anchor based on current scroll position (last highlight above viewport)
    const anchorY = (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0) + 1;
    let idxAnchor = -1;
    for (let i = 0; i < navList.length; i++) {
      try {
        const rect = navList[i].wrap.getBoundingClientRect();
        const y = rect.top + (window.scrollY || 0);
        if (y <= anchorY) idxAnchor = i; else break;
      } catch {}
    }
    navIndex = idxAnchor;
  }
  function focusWrap(wrap) {
    try { wrap.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { wrap.scrollIntoView(true); }
    // brief outline to indicate focus
    for (const w of wrappers) { w.wrap.style.outline = ""; w.wrap.style.outlineOffset = ""; }
    wrap.style.outline = "2px solid #aaa";
    wrap.style.outlineOffset = "-2px";
    lastFocusedWrap = wrap;
  }
  function gotoNextHighlighted() {
    if (!navList.length) { rebuildNavList(); }
    if (!navList.length) return;
    navIndex = (navIndex + 1) % navList.length;
    focusWrap(navList[navIndex].wrap);
  }
  function gotoPrevHighlighted() {
    if (!navList.length) { rebuildNavList(); }
    if (!navList.length) return;
    navIndex = (navIndex - 1 + navList.length) % navList.length;
    focusWrap(navList[navIndex].wrap);
  }

    navBtnDown.addEventListener('click', gotoNextHighlighted);
    navBtnUp.addEventListener('click', gotoPrevHighlighted);

    // --- Hide non-highlighted/non-selected toggle ---
    function removePlaceholders() {
      try {
        const phs = container.querySelectorAll('[data-fhl-placeholder="1"]');
        phs.forEach(ph => ph.parentNode && ph.parentNode.removeChild(ph));
      } catch {}
    }
      function insertPlaceholder(groupStart, count, open) {
        const beforeElem = wrappers[groupStart] && wrappers[groupStart].wrap;
        const ph = document.createElement('div');
        ph.dataset.fhlPlaceholder = '1';
        ph.dataset.start = String(groupStart);
        ph.dataset.count = String(count);
        ph.dataset.open = open ? '1' : '0';
        ph.style.cssText = "color:#9aa7bd; font-style:italic; border:1px dashed #333; border-radius:4px; background:#0f0f0f; cursor:pointer;";
      stylePlaceholderElement(ph);
        ph.textContent = open ? `Hide ${count} messages` : `${count} messages hidden`;
            ph.addEventListener('click', () => {
              const start = parseInt(ph.dataset.start || '-1', 10);
              const cnt = parseInt(ph.dataset.count || '0', 10);
              if (!isFinite(start) || start < 0 || !isFinite(cnt) || cnt <= 0) return;
              const end = start + cnt - 1;
              if (ph.dataset.open === '1') {
                // Close just this group's range (preserve other open portions)
                const next = [];
                for (const r of openHiddenRanges) {
                  if (!(r.s <= end && start <= r.e)) { next.push(r); continue; }
                  if (r.s < start) next.push({ s: r.s, e: Math.min(start - 1, r.e) });
                  if (end < r.e) next.push({ s: Math.max(end + 1, r.s), e: r.e });
                }
                openHiddenRanges = next;
              } else {
                // Open: merge with any overlapping ranges
                let ns = start, ne = end;
                const merged = [];
                for (const r of openHiddenRanges) {
                  if (r.e + 1 < ns || ne + 1 < r.s) merged.push(r);
                  else { ns = Math.min(ns, r.s); ne = Math.max(ne, r.e); }
                }
                merged.push({ s: ns, e: ne });
                merged.sort((a,b)=>a.s-b.s);
                openHiddenRanges = merged;
              }
              applyVisibility();
            });
        try { container.insertBefore(ph, beforeElem); } catch { container.appendChild(ph); }
      }
      function updateHiddenPlaceholders() {
        if (adsMode) { try { removeAdsPlaceholders(); } catch {} }
        if (!hideMode) {
          removePlaceholders();
          for (const w of wrappers) { w.wrap.style.display = ''; }
            openHiddenRanges = [];
          return;
        }
        removePlaceholders();
        let groupStart = -1;
        let groupCount = 0;
        for (let i = 0; i < wrappers.length; i++) {
          const w = wrappers[i];
          const keep = (w.wrap.dataset && (w.wrap.dataset.fhlSelected === '1' || w.wrap.dataset.fhlHi === '1'));
          if (keep) {
            w.wrap.style.display = '';
            if (groupStart !== -1) {
              const isOpen = isRangeOpen(groupStart, groupStart + groupCount - 1);
              if (isOpen) {
                if (adsMode) {
                  let runStart = -1;
                  let runOpen = false;
                  for (let j = groupStart; j < groupStart + groupCount; j++) {
                    const ww = wrappers[j];
                    const isAd = !(ww.wrap.dataset && ww.wrap.dataset.fhlAds === '1');
                    if (isAd) {
                      const curOpen = adsIsRangeOpen(j, j);
                      ww.wrap.style.display = curOpen ? '' : 'none';
                      if (runStart === -1) {
                        runStart = j; runOpen = curOpen;
                      } else if (runOpen !== curOpen) {
                        const runEnd = j - 1;
                        insertAdsPlaceholder(runStart, runEnd - runStart + 1, runOpen);
                        runStart = j; runOpen = curOpen;
                      }
                    } else {
                      // non-ads
                      ww.wrap.style.display = '';
                      if (runStart !== -1) {
                        const runEnd = j - 1;
                        insertAdsPlaceholder(runStart, runEnd - runStart + 1, runOpen);
                        runStart = -1;
                      }
                    }
                  }
                  if (runStart !== -1) {
                    const runEnd = (groupStart + groupCount) - 1;
                    insertAdsPlaceholder(runStart, runEnd - runStart + 1, runOpen);
                  }
                } else {
                  for (let j = groupStart; j < groupStart + groupCount; j++) {
                    wrappers[j].wrap.style.display = '';
                  }
                }
              }
              insertPlaceholder(groupStart, groupCount, isOpen);
              groupStart = -1; groupCount = 0;
            }
          } else {
            // defer display decision until we know if this group is open
            if (groupStart === -1) { groupStart = i; groupCount = 1; } else { groupCount++; }
          }
        }
        if (groupStart !== -1) {
          const isOpen = isRangeOpen(groupStart, groupStart + groupCount - 1);
          if (isOpen) {
            if (adsMode) {
              let runStart = -1;
              let runOpen = false;
              for (let j = groupStart; j < groupStart + groupCount; j++) {
                const ww = wrappers[j];
                const isAd = !(ww.wrap.dataset && ww.wrap.dataset.fhlAds === '1');
                if (isAd) {
                  const curOpen = adsIsRangeOpen(j, j);
                  ww.wrap.style.display = curOpen ? '' : 'none';
                  if (runStart === -1) {
                    runStart = j; runOpen = curOpen;
                  } else if (runOpen !== curOpen) {
                    const runEnd = j - 1;
                    insertAdsPlaceholder(runStart, runEnd - runStart + 1, runOpen);
                    runStart = j; runOpen = curOpen;
                  }
                } else {
                  ww.wrap.style.display = '';
                  if (runStart !== -1) {
                    const runEnd = j - 1;
                    insertAdsPlaceholder(runStart, runEnd - runStart + 1, runOpen);
                    runStart = -1;
                  }
                }
              }
              if (runStart !== -1) {
                const runEnd = (groupStart + groupCount) - 1;
                insertAdsPlaceholder(runStart, runEnd - runStart + 1, runOpen);
              }
            } else {
              for (let j = groupStart; j < groupStart + groupCount; j++) {
                wrappers[j].wrap.style.display = '';
              }
            }
          }
          insertPlaceholder(groupStart, groupCount, isOpen);
        }
        // apply hiding for items not in open groups; and within open groups, keep Ads hidden unless opened
        for (let i = 0; i < wrappers.length; i++) {
          const w = wrappers[i];
          const keepSelHi = (w.wrap.dataset && (w.wrap.dataset.fhlSelected === '1' || w.wrap.dataset.fhlHi === '1'));
          if (keepSelHi) continue;
          const inOpen = isRangeOpen(i, i);
          if (!inOpen) {
            w.wrap.style.display = 'none';
          } else {
            if (adsMode) {
              const isAd = !(w.wrap.dataset && w.wrap.dataset.fhlAds === '1');
              const inOpenAd = adsIsRangeOpen(i, i);
              w.wrap.style.display = (!isAd || inOpenAd) ? '' : 'none';
            } else {
              w.wrap.style.display = '';
            }
          }
        }
      }
      
      // ADS-only placeholders, similar to hideMode placeholders
      function removeAdsPlaceholders() {
        try {
          const phs = container.querySelectorAll('[data-fhl-placeholder-ads="1"]');
          phs.forEach(ph => ph.parentNode && ph.parentNode.removeChild(ph));
        } catch {}
      }
      function insertAdsPlaceholder(groupStart, count, open) {
        const beforeElem = wrappers[groupStart] && wrappers[groupStart].wrap;
        const ph = document.createElement('div');
        ph.dataset.fhlPlaceholderAds = '1';
        ph.dataset.start = String(groupStart);
        ph.dataset.count = String(count);
        ph.dataset.open = open ? '1' : '0';
        ph.style.cssText = "color:#9aa7bd; font-style:italic; border:1px dashed #333; border-radius:4px; background:#0f0f0f; cursor:pointer;";
      stylePlaceholderElement(ph);
        ph.textContent = open ? `Hide ${count} ads` : `${count} ads hidden`;
        ph.addEventListener('click', () => {
          const start = parseInt(ph.dataset.start || '-1', 10);
          const cnt = parseInt(ph.dataset.count || '0', 10);
          if (!isFinite(start) || start < 0 || !isFinite(cnt) || cnt <= 0) return;
          const end = start + cnt - 1;
          if (ph.dataset.open === '1') {
            // Close just this ADS group's range (preserve other open portions)
            const next = [];
            for (const r of openAdsRanges) {
              if (!(r.s <= end && start <= r.e)) { next.push(r); continue; }
              if (r.s < start) next.push({ s: r.s, e: Math.min(start - 1, r.e) });
              if (end < r.e) next.push({ s: Math.max(end + 1, r.s), e: r.e });
            }
            openAdsRanges = next;
          } else {
            // Open: merge with any overlapping ADS ranges
            let ns = start, ne = end;
            const merged = [];
            for (const r of openAdsRanges) {
              if (r.e + 1 < ns || ne + 1 < r.s) merged.push(r);
              else { ns = Math.min(ns, r.s); ne = Math.max(ne, r.e); }
            }
            merged.push({ s: ns, e: ne });
            merged.sort((a,b)=>a.s-b.s);
            openAdsRanges = merged;
          }
          applyVisibility();
        });
        try { container.insertBefore(ph, beforeElem); } catch { container.appendChild(ph); }
      }
      function updateAdsPlaceholders() {
        if (!adsMode) {
          removeAdsPlaceholders();
          for (const w of wrappers) { w.wrap.style.display = ''; }
          openAdsRanges = [];
          return;
        }
        removeAdsPlaceholders();
        let groupStart = -1;
        let groupCount = 0;
        for (let i = 0; i < wrappers.length; i++) {
          const w = wrappers[i];
          const keep = (w.wrap.dataset && (w.wrap.dataset.fhlAds === '1' || w.wrap.dataset.fhlSelected === '1' || w.wrap.dataset.fhlHi === '1'));
          if (keep) {
            w.wrap.style.display = '';
            if (groupStart !== -1) {
              const isOpen = adsIsRangeOpen(groupStart, groupStart + groupCount - 1);
              if (isOpen) {
                for (let j = groupStart; j < groupStart + groupCount; j++) {
                  wrappers[j].wrap.style.display = '';
                }
              }
              insertAdsPlaceholder(groupStart, groupCount, isOpen);
              groupStart = -1; groupCount = 0;
            }
          } else {
            if (groupStart === -1) { groupStart = i; groupCount = 1; } else { groupCount++; }
          }
        }
        if (groupStart !== -1) {
          const isOpen = adsIsRangeOpen(groupStart, groupStart + groupCount - 1);
          if (isOpen) {
            for (let j = groupStart; j < groupStart + groupCount; j++) {
              wrappers[j].wrap.style.display = '';
            }
          }
          insertAdsPlaceholder(groupStart, groupCount, isOpen);
        }
        // hide not-open ADS groups
        for (let i = 0; i < wrappers.length; i++) {
          const w = wrappers[i];
          const keep = (w.wrap.dataset && (w.wrap.dataset.fhlAds === '1' || w.wrap.dataset.fhlSelected === '1' || w.wrap.dataset.fhlHi === '1'));
          if (keep) continue;
          const inOpen = adsIsRangeOpen(i, i);
          w.wrap.style.display = inOpen ? '' : 'none';
        }
      }

      // Apply current visibility rules combining hide-mode and ads filter
      function applyVisibility() {
        rebuildNavList();
        if (hideMode) {
          removeAdsPlaceholders();
          updateHiddenPlaceholders();
        } else if (adsMode) {
          removePlaceholders();
          updateAdsPlaceholders();
        } else {
          removePlaceholders();
          removeAdsPlaceholders();
          for (const w of wrappers) { w.wrap.style.display = ''; }
        }
      }

  // Parse extra names from input
  function parseExtraNames(value) {
    return (value || "")
      .split(/[,\n]/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  // Load/save preferences via localStorage
  const STORE_KEY = "fchatHighlighterExtras";
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) extraInput.value = saved;
  } catch {}

    function updateHighlights() {
    const extras = parseExtraNames(extraInput.value);
    // Preserve current position if possible; index adjusted in rebuildNavList()
    for (const { wrap, msg } of wrappers) {
      let isHi = false;
      // default
      wrap.style.background = "transparent";
      wrap.style.border = "transparent";
      const s = msg.afterNoStar || "";
      if (highlightToggles.report && afterStartsWithName(s, reportName)) {
        wrap.style.background = COLOR_REPORT;
        wrap.style.border = "1px solid #400";
        isHi = true;
      } else if (highlightToggles.submit && afterStartsWithName(s, submitName)) {
        wrap.style.background = COLOR_SUBMIT;
        wrap.style.border = "1px solid #024";
        isHi = true;
      } else {
        // additional names (green)
        if (highlightToggles.extra) {
          for (const n of extras) {
            if (afterStartsWithName(s, n)) {
              wrap.style.background = COLOR_EXTRA;
              wrap.style.border = "1px solid #063";
              isHi = true;
              break;
            }
          }
        }
      }
      if (isHi) {
        wrap.dataset.fhlHi = '1';
      } else {
        wrap.dataset.fhlHi = '0';
      }
    }
      applyVisibility();
    }

  // --- Submitted-on timestamp ---
  function formatLocalRFCish(date) {
    try {
      const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const pad = n => String(n).padStart(2, '0');
      const off = -date.getTimezoneOffset();
      const sign = off >= 0 ? '+' : '-';
      const a = Math.abs(off);
      const oh = pad(Math.floor(a / 60));
      const om = pad(a % 60);
      return `${days[date.getDay()]}, ${pad(date.getDate())} ${months[date.getMonth()]} ${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${sign}${oh}${om}`;
    } catch { return ""; }
  }
  function applySubmittedOnLocal() {
    if (!submittedOn || !submittedOnStrong) return;
    try {
      const dt = new Date(submittedOn);
      if (!isNaN(dt.getTime())) submittedOnStrong.textContent = formatLocalRFCish(dt);
    } catch {}
  }
  applySubmittedOnLocal();

  // Wire events
  extraInput.addEventListener("input", () => {
    try { localStorage.setItem(STORE_KEY, extraInput.value); } catch {}
    updateHighlights();
  });

  // Initial highlight pass
  updateHighlights();
  applyCompactModeStyles();
  applyTextSize();
})();
