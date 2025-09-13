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
  const headerRe = /^\s*\[(?:\d{1,2}:\d{2}(?:\s*[AP]M)?|\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?:\s*[AP]M)?)\]\s*(.*)$/i;
  const tsStartRe = /^\s*\[(?:\d{1,2}:\d{2}(?:\s*[AP]M)?|\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?:\s*[AP]M)?)\]/i;

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
  if (!fullText.trim()) return;

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
      let m = fullText.match(/Report text:\s*([\s\S]*?)(?=\r?\n\s*\[(?:\d{1,2}:\d{2}(?:\s*[AP]M)?|\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?:\s*[AP]M)?)\]|$)/i);
      if (!m) {
        // Fallback: allow inline timestamp immediately after report text (no newline)
        const rtIdx = fullText.search(/Report text:/i);
        if (rtIdx !== -1) {
          const after = fullText.slice(rtIdx + (fullText.match(/Report text:/i) || [])[0].length);
          const tsIdx = after.search(/\[(?:\d{1,2}:\d{2}(?:\s*[AP]M)?|\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?:\s*[AP]M)?)\]/i);
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
  const lines = fullText.split(/\r?\n/);
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

  // Clear the page and inject our structured view
  document.documentElement.style.background = "#0b0b0b"; // dark back helps highlights stand out
  document.body.innerHTML = "";
  document.body.style.cssText = "margin:0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace; background:#0b0b0b; color:#e6e6e6;";

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
  const versionLabel = document.createElement("div");
  versionLabel.textContent = "F-list Log Highlighter v2.3";
  versionLabel.style.cssText = "position:absolute; top:12px; right:44px; color:#9aa7bd; font-size:12px; pointer-events:none;";
  header.appendChild(versionLabel);
  header.appendChild(closeBtn);
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
      strong.textContent = "(unknown)";
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
  // Custom row for 'Log submitted on' with a convert-to-local button
  const { row: submittedOnRow, strong: submittedOnStrong } = appendValueRow("Log submitted on", submittedOn);
  const convertBtn = document.createElement("button");
  convertBtn.textContent = "Convert times to local";
  convertBtn.title = "Convert all [HH:MM] timestamps to your local time";
  convertBtn.style.cssText = "margin-left:8px; padding:4px 8px; border:1px solid #333; border-radius:4px; background:#151515; color:#ccc; cursor:pointer;";
  convertBtn.addEventListener("mouseenter", () => { convertBtn.style.background = "#1f1f1f"; });
  convertBtn.addEventListener("mouseleave", () => { convertBtn.style.background = "#151515"; });
  submittedOnRow.appendChild(convertBtn);
  const reportingUserRow = appendNameRow("Reporting user", reportingUser);
  // Prefix star if tab slug in parentheses matches the allowlist
  let tabDisplay = tabName;
  const tabSlug = extractParenSlug(tabName);
  if (tabSlug && STAR_TAB_SLUGS.has(canonSlug(tabSlug))) tabDisplay = `\u2605${tabName}`; // ★
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
  navBtnUp.textContent = "\u25B2"; // ▲
  navBtnUp.title = "Previous highlighted message";
  navBtnUp.style.cssText = "padding:4px 8px; border:1px solid #333; border-radius:4px; background:#151515; color:#ccc; cursor:pointer;";
  navBtnUp.addEventListener("mouseenter", () => { navBtnUp.style.background = "#1f1f1f"; });
  navBtnUp.addEventListener("mouseleave", () => { navBtnUp.style.background = "#151515"; });
  const navBtnDown = document.createElement("button");
  navBtnDown.textContent = "\u25BC"; // ▼
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
      // Collect in chronological order (wrappers insertion order)
      const selected = wrappers.filter(w => w && w.wrap && w.wrap.dataset && w.wrap.dataset.fhlSelected === '1');
        if (!selected.length) {
          copyBtn.textContent = 'Nothing selected';
          setTimeout(() => { try { setCopyBtnIcon(); } catch {} }, 1200);
          return;
        }
      const text = selected.map(w => w.pre && w.pre.textContent ? w.pre.textContent : '').join('\n');
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
      adsBtn.title = adsMode ? 'Show all messages' : 'Hide unless first char is * or a name-ending ": " appears within first 22 chars';
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
  collapseBtn.textContent = "▴";
  collapseBtn.title = "Collapse header";
  // Ensure ASCII-only label to avoid encoding issues
  try { collapseBtn.textContent = "v"; } catch {}
  collapseBtn.style.cssText = "position:absolute; bottom:6px; left:50%; transform:translateX(-50%); width:28px; height:20px; line-height:18px; text-align:center; border:1px solid #333; border-radius:4px; background:#151515; color:#ccc; cursor:pointer;";
  collapseBtn.addEventListener("mouseenter", () => { collapseBtn.style.background = "#1f1f1f"; });
  collapseBtn.addEventListener("mouseleave", () => { collapseBtn.style.background = "#151515"; });
  header.appendChild(collapseBtn);
  // Max icon counter (bottom-right)
  const maxIconBadge = document.createElement("div");
  maxIconBadge.style.cssText = "position:absolute; bottom:6px; right:8px; padding:2px 6px; border:1px solid #333; border-radius:4px; background:#151515; color:#ccc; font-size:12px;";
  maxIconBadge.textContent = `Reported max eicons: ${maxReportedIcons}`;
  header.appendChild(maxIconBadge);

  // Restore button (shows only when header collapsed)
  const restoreBtn = document.createElement("button");
  restoreBtn.textContent = "▾";
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

  const container = document.createElement("div");
  container.style.cssText = "padding: 12px 16px; display:flex; flex-direction:column; gap:8px;";
  document.body.appendChild(container);

  // Render each message in a block with background if sender matches
  const submitName = submittedByRaw;
  const reportName = reportingUserRaw;
  const wrappers = [];

  for (const msg of messages) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "border-radius:6px; padding:8px 10px; white-space:pre-wrap; line-height:1.35;";

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
        ph.style.cssText = "margin:6px 0; padding:6px 8px; color:#9aa7bd; font-style:italic; border:1px dashed #333; border-radius:4px; background:#0f0f0f; cursor:pointer;";
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
        ph.style.cssText = "margin:6px 0; padding:6px 8px; color:#9aa7bd; font-style:italic; border:1px dashed #333; border-radius:4px; background:#0f0f0f; cursor:pointer;";
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
  const CONVERT_STORE_KEY = "fchatHighlighterConvertLocal";
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

  // --- Timestamp conversion ---
  function parseOffsetMinutesFromSubmittedOn(text) {
    const m = (text || "").match(/([+-])(\d{2})(\d{2})\b/);
    if (!m) return 0; // default UTC
    const sign = m[1] === '-' ? -1 : 1;
    const hh = parseInt(m[2], 10) || 0;
    const mm = parseInt(m[3], 10) || 0;
    return sign * (hh * 60 + mm);
  }
  function parseBaseYMD(text) {
    // Expect formats like: Wed, 10 Sep 2025 16:33:25 +0000
    const months = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
    const m = (text || "").match(/\b(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\b/);
    if (m && Object.prototype.hasOwnProperty.call(months, m[2])) {
      return { y: parseInt(m[3], 10), mo: months[m[2]], d: parseInt(m[1], 10) };
    }
    try {
      const d = new Date(text);
      if (!isNaN(d.getTime())) return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate() };
    } catch {}
    const now = new Date();
    return { y: now.getFullYear(), mo: now.getMonth(), d: now.getDate() };
  }
  function toLocalHHMMFromBase(hh, mm, base, offsetMinutes) {
    // base is {y, mo, d}; offsetMinutes is the source timezone offset minutes
    const utcMs = Date.UTC(base.y, base.mo, base.d, hh, mm) - offsetMinutes * 60000;
    const local = new Date(utcMs);
    return local.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }
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
  const srcOffsetMin = parseOffsetMinutesFromSubmittedOn(submittedOn || "");
  const baseDate = parseBaseYMD(submittedOn || "");
  const timeReShort = /\[(\d{1,2}):(\d{2})(?:\s*([AP]M))?\]/gi; // [HH:MM][ AM/PM]
  const timeReLong = /\[(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})(?:\s*([AP]M))?\]/gi; // [YYYY-MM-DD HH:MM][ AM/PM]
  function to24h(h, ap) {
    let hh = Math.max(0, Math.min(23, parseInt(h, 10) || 0));
    if (!ap) return hh;
    const up = String(ap).toUpperCase();
    hh = Math.max(1, Math.min(12, parseInt(h, 10) || 12));
    if (up === 'AM') return hh % 12; // 12AM -> 0
    if (up === 'PM') return (hh % 12) + 12; // 12PM -> 12
    return hh;
  }
  let timesConverted = false;
  const submittedOnOriginal = submittedOnStrong.textContent;
  function convertAllTimes() {
    for (const w of wrappers) {
      let replaced = w.origText
        .replace(timeReLong, (_, y, mo, d, h, m, ap) => {
          const yy = parseInt(y, 10);
          const mm0 = Math.max(1, Math.min(12, parseInt(mo, 10) || 1)) - 1;
          const dd = Math.max(1, Math.min(31, parseInt(d, 10) || 1));
          const hh = to24h(h, ap);
          const mi = Math.max(0, Math.min(59, parseInt(m, 10) || 0));
          const out = toLocalHHMMFromBase(hh, mi, { y: yy, mo: mm0, d: dd }, srcOffsetMin);
          return `[${y}-${mo}-${d} ${out}]`;
        })
        .replace(timeReShort, (_, h, m, ap) => {
          const hh = to24h(h, ap);
          const mi = Math.max(0, Math.min(59, parseInt(m, 10) || 0));
          const out = toLocalHHMMFromBase(hh, mi, baseDate, srcOffsetMin);
          return `[${out}]`;
        });
      w.pre.textContent = replaced;
    }
    // Replace submitted-on time with local formatted time
    try {
      const dt = new Date(submittedOn || "");
      if (!isNaN(dt.getTime())) submittedOnStrong.textContent = formatLocalRFCish(dt);
    } catch {}
    convertBtn.textContent = "Show original times";
    timesConverted = true;
    try { localStorage.setItem(CONVERT_STORE_KEY, "1"); } catch {}
  }
  function restoreAllTimes() {
    for (const w of wrappers) {
      w.pre.textContent = w.origText;
    }
    // Restore original submitted-on text
    submittedOnStrong.textContent = submittedOnOriginal;
    convertBtn.textContent = "Convert times to local";
    timesConverted = false;
    try { localStorage.removeItem(CONVERT_STORE_KEY); } catch {}
  }
  convertBtn.addEventListener('click', () => {
    if (timesConverted) restoreAllTimes(); else convertAllTimes();
  });

  // Apply saved preference for local time conversion
  try {
    if (localStorage.getItem(CONVERT_STORE_KEY) === "1") {
      convertAllTimes();
    }
  } catch {}

  // Wire events
  extraInput.addEventListener("input", () => {
    try { localStorage.setItem(STORE_KEY, extraInput.value); } catch {}
    updateHighlights();
  });

  // Initial highlight pass
  updateHighlights();
})();
