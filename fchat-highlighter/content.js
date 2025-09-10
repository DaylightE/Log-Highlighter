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

  function makeLegendItem(color, label) {
    const span = document.createElement("span");
    const sw = document.createElement("span");
    sw.style.cssText = `display:inline-block; width:12px; height:12px; background:${color}; border:1px solid rgba(255,255,255,0.12); vertical-align:middle; margin-right:6px;`;
    span.appendChild(sw);
    span.append(document.createTextNode(label));
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
  const messages = []; // {afterNoStar: string, blockLines: string[]}
  let cur = null;

  for (const line of lines) {
    const hm = line.match(headerRe);
    if (hm) {
      // Start new message
      if (cur) messages.push(cur);
      const after = hm[1] || "";
      // Extract sender after optional leading '*'
      const afterNoStar = after.replace(/^\s*\*/, "");
      cur = { afterNoStar, blockLines: [line] };
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
  versionLabel.textContent = "F-list Log Highlighter v1.4";
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
    "Herm":        "#5b2b8a", // Dark Purple
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
  legend.appendChild(makeLegendItem(COLOR_REPORT, "Reported user"));
  legend.appendChild(makeLegendItem(COLOR_SUBMIT, "Log submitted by"));
  legend.appendChild(makeLegendItem(COLOR_EXTRA, "Additional"));
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
    wrappers.push({ wrap, pre, msg, origText: pre.textContent });
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
    for (const { wrap, msg } of wrappers) {
      // default
      wrap.style.background = "transparent";
      wrap.style.border = "transparent";
      const s = msg.afterNoStar || "";
      if (afterStartsWithName(s, reportName)) {
        wrap.style.background = COLOR_REPORT;
        wrap.style.border = "1px solid #400";
      } else if (afterStartsWithName(s, submitName)) {
        wrap.style.background = COLOR_SUBMIT;
        wrap.style.border = "1px solid #024";
      } else {
        // additional names (green)
        for (const n of extras) {
          if (afterStartsWithName(s, n)) {
            wrap.style.background = COLOR_EXTRA;
            wrap.style.border = "1px solid #063";
            break;
          }
        }
      }
    }
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
