const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { JSDOM } = require("jsdom");

const STORE_KEY = "fhlKinkComparisonProfile";
const source = readFileSync("fchat-highlighter-chrome/kink-comparison.js", "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
const snapshot = (kinks, name = "Saved Character", characterId = "100") => ({ version: 1, name, characterId, kinks });

function storageHub(initial) {
  let data = initial === undefined ? {} : { [STORE_KEY]: structuredClone(initial) };
  const listeners = new Set();
  const hub = {
    failure: "",
    get data() { return structuredClone(data); },
    api: {
      onChanged: { addListener(listener) { listeners.add(listener); } },
      local: {
        async get(key) {
          if (hub.failure === "get") throw new Error("Storage unavailable");
          return structuredClone({ [key]: data[key] });
        },
        async set(values) {
          if (hub.failure === "set") throw new Error("Storage unavailable");
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = { oldValue: data[key], newValue: structuredClone(value) };
            data[key] = structuredClone(value);
          }
          for (const listener of listeners) listener(changes, "local");
        },
        async remove(key) {
          if (hub.failure === "remove") throw new Error("Storage unavailable");
          const changes = { [key]: { oldValue: data[key] } };
          delete data[key];
          for (const listener of listeners) listener(changes, "local");
        }
      }
    }
  };
  return hub;
}

function profileHtml(kinks, { name = "Current Character", characterId = "200", native = true } = {}) {
  const categories = { fave: "Fave", yes: "Yes", maybe: "Maybe", no: "No" };
  return `<!doctype html><html><body>
    <div id="Character_FetishFilterHeader"><div style="float:right">Highlight: <select><option>None</option></select></div>
      ${native ? '<a id="native-quickcompare" href="#">QuickCompare</a>' : ""}
    </div>
    <table id="Character_FetishList"><tbody><tr>${Object.entries(categories).map(([choice, label]) =>
      `<td id="Character_Fetishlist${label}"><h3>${label}</h3>${Object.entries(kinks).filter(([, value]) => value === choice).map(([id]) =>
        `<a class="Character_Fetish Character_ListedFetish" id="Character_ListedFetish${id}">Kink ${id}</a><br>`
      ).join("")}</td>`
    ).join("")}</tr></tbody></table>
    <input type="hidden" id="profile-character-name" value="${name}">
    <input type="hidden" id="profile-character-id" value="${characterId}">
    </body></html>`;
}

async function openProfile(hub, kinks = {}, options = {}) {
  const dom = new JSDOM(profileHtml(kinks, options), {
    url: options.url || "https://www.f-list.net/c/Current%20Character",
    runScripts: "outside-only"
  });
  dom.window[options.browser || "chrome"] = { storage: hub.api };
  if (options.beforeRun) options.beforeRun(dom.window);
  dom.window.eval(source);
  await tick();
  return {
    window: dom.window,
    document: dom.window.document,
    get status() { return dom.window.document.getElementById("fhl-kink-comparison-status")?.textContent; },
    get save() { return dom.window.document.getElementById("fhl-save-kinks"); },
    get clear() { return dom.window.document.getElementById("fhl-clear-kinks"); },
    kink(id) { return dom.window.document.getElementById(`Character_ListedFetish${id}`); },
    async click(element) { element.click(); await tick(); }
  };
}

test("Chrome and Firefox ship identical scripts with profile matching and local storage", () => {
  assert.equal(source, readFileSync("fchat-highlighter-firefox/kink-comparison.js", "utf8"));
  for (const browser of ["chrome", "firefox"]) {
    const manifest = JSON.parse(readFileSync(`fchat-highlighter-${browser}/manifest.json`, "utf8").replace(/^\uFEFF/, ""));
    assert.ok(manifest.permissions.includes("storage"));
    assert.ok(manifest.content_scripts.some(script => script.js.includes("kink-comparison.js") && script.matches.some(match => match.endsWith("/c/*"))));
    new Function(readFileSync(`fchat-highlighter-${browser}/kink-comparison.js`, "utf8"));
  }
});

for (const browser of ["chrome", "browser"]) {
  test(`${browser}: save beside QuickCompare, compare future profiles, replace, update and clear`, async () => {
    const hub = storageHub();
    const first = await openProfile(hub, { 1: "fave", 2: "yes", 3: "maybe", 4: "no" }, { browser, name: "First Character", characterId: "101" });
    assert.equal(first.document.querySelector("#native-quickcompare + #fhl-kink-comparison")?.id, "fhl-kink-comparison");
    assert.equal(first.save.type, "button");
    assert.equal(first.clear.hidden, true);
    assert.match(first.status, /Save a profile/);
    await first.click(first.save);
    assert.deepEqual(hub.data[STORE_KEY], snapshot({ 1: "fave", 2: "yes", 3: "maybe", 4: "no" }, "First Character", "101"));
    assert.match(first.status, /100%.*4\/4 shared kinks; 0 unique/);
    assert.equal(first.save.textContent, "(Staff) Save kinks for comparison");

    const second = await openProfile(hub, { 1: "fave", 2: "fave", 3: "maybe", 4: "no", 5: "yes" }, { browser });
    assert.match(second.status, /75% match with First Character \(3\/4 shared kinks; 1 unique\)/);
    for (const [id, category] of [[1, "Fave"], [2, "Yes"], [3, "Maybe"], [4, "No"]]) {
      assert.ok(second.kink(id).classList.contains(`Character_QuickCompare${category}`));
      assert.ok(second.kink(id).classList.contains("Character_QuickCompareActive"));
    }
    assert.equal(second.kink(5).classList.contains("Character_QuickCompareActive"), false);
    const reopened = await openProfile(hub, { 2: "yes" }, { browser });
    assert.match(reopened.status, /100%.*1\/1/);

    await second.click(second.save);
    assert.equal(hub.data[STORE_KEY].name, "Current Character");
    assert.match(first.status, /75% match with Current Character/);
    assert.match(second.status, /100%.*5\/5/);
    // Updating a saved snapshot uses the page's current categories.
    second.document.getElementById("Character_FetishlistNo").appendChild(second.kink(1));
    await second.click(second.save);
    assert.equal(hub.data[STORE_KEY].kinks[1], "no");
    assert.ok(first.kink(1).classList.contains("Character_QuickCompareNo"));

    await first.click(first.clear);
    assert.equal(hub.data[STORE_KEY], undefined);
    assert.equal(second.clear.hidden, true);
    assert.match(second.status, /Save a profile/);
    assert.equal(second.document.querySelectorAll(".Character_QuickCompareActive").length, 0);
  });
}

test("only shared, explicitly categorized standard kinks contribute to the percentage", async () => {
  const hub = storageHub(snapshot({ 1: "fave", 2: "no", 3: "yes" }));
  const partial = await openProfile(hub, { 1: "fave", 2: "maybe", 8: "yes", 9: "no" });
  assert.match(partial.status, /50%.*1\/2 shared kinks; 3 unique/);
  const zero = await openProfile(hub, { 1: "yes", 2: "maybe" });
  assert.match(zero.status, /0%.*0\/2 shared kinks; 1 unique/);
  const none = await openProfile(hub, { 8: "yes" });
  assert.match(none.status, /N\/A.*no shared kinks; 4 unique/);
  const empty = await openProfile(hub);
  assert.equal(empty.save.disabled, true);
  assert.match(empty.status, /N\/A.*no shared kinks; 3 unique/);
  const rounded = await openProfile(hub, { 1: "fave", 2: "maybe", 3: "no" });
  assert.match(rounded.status, /33\.3%.*1\/3 shared kinks; 0 unique/);
});

test("collapsed standard subkinks inherit their custom group's category; custom names are excluded", async () => {
  const hub = storageHub();
  const profile = await openProfile(hub, { 1: "yes" }, {
    beforeRun(window) {
      const column = window.document.getElementById("Character_FetishlistMaybe");
      column.innerHTML += '<a class="Character_CustomFetish" id="Character_CustomFetish999">Custom label</a><div class="Closed" id="Character_SubfetishList999" style="display:none"><a class="Character_ListedFetish" id="Character_ListedFetish2">Nested standard kink</a></div>';
    }
  });
  await profile.click(profile.save);
  assert.deepEqual(hub.data[STORE_KEY].kinks, { 1: "yes", 2: "maybe" });
  const next = await openProfile(hub, { 1: "yes", 2: "maybe" });
  assert.match(next.status, /100%.*2\/2/);
});

test("public pages mount in the kink header and duplicate injection is harmless", async () => {
  const page = await openProfile(storageHub(), { 1: "yes" }, { native: false });
  assert.equal(page.document.getElementById("fhl-kink-comparison").parentElement.id, "Character_FetishFilterHeader");
  page.window.eval(source);
  assert.equal(page.document.querySelectorAll("#fhl-kink-comparison").length, 1);
});

test("unavailable, log and profile editing pages stay untouched", async () => {
  for (const url of ["https://www.f-list.net/fchat/getLog.php?log=1", "https://www.f-list.net/c/Character/edit"]) {
    const page = await openProfile(storageHub(), { 1: "yes" }, { url });
    assert.equal(page.save, null);
  }
  const missing = await openProfile(storageHub(), { 1: "yes" }, {
    beforeRun(window) { window.document.getElementById("Character_FetishList").remove(); }
  });
  assert.equal(missing.save, null);
});

test("corrupt saved data is ignored and profile names are rendered as text", async () => {
  for (const value of [null, {}, snapshot({ 1: "unknown" }), snapshot({ 1: ["yes"] }), snapshot([]), snapshot({}), { ...snapshot({ 1: "yes" }), version: 9 }]) {
    const page = await openProfile(storageHub(value), { 1: "yes" });
    assert.match(page.status, /Save a profile/);
    assert.equal(page.clear.hidden, true);
  }
  const page = await openProfile(storageHub(snapshot({ 1: "yes" }, '<img src=x onerror="alert(1)">')) , { 1: "yes" });
  assert.match(page.status, /<img/);
  assert.equal(page.document.querySelectorAll("#fhl-kink-comparison-status img").length, 0);
  assert.match(page.document.querySelector("#fhl-kink-comparison-status a").getAttribute("href"), /^\/c\/%3Cimg/);
});

test("storage failures are visible and failed writes preserve the saved comparison", async () => {
  const saved = snapshot({ 1: "yes" });
  const hub = storageHub(saved);
  hub.failure = "get";
  const page = await openProfile(hub, { 1: "yes" });
  assert.match(page.status, /Could not load/);
  assert.equal(page.save.disabled, false);
  hub.failure = "";
  await page.click(page.save);
  assert.match(page.status, /100%/);
  const existing = hub.data[STORE_KEY];
  hub.failure = "set";
  await page.click(page.save);
  assert.match(page.status, /Could not save/);
  assert.deepEqual(hub.data[STORE_KEY], existing);
  hub.failure = "remove";
  await page.click(page.clear);
  assert.match(page.status, /Could not clear/);
  assert.deepEqual(hub.data[STORE_KEY], existing);
  assert.equal(page.clear.hidden, false);
  assert.equal(page.save.disabled, false);
});

test("a newer cross-tab change wins over an in-flight initial storage read", async () => {
  const hub = storageHub();
  let finishRead;
  hub.api.local.get = () => new Promise(resolve => { finishRead = resolve; });
  const page = await openProfile(hub, { 1: "yes" });
  await hub.api.local.set({ [STORE_KEY]: snapshot({ 1: "yes" }, "Newer Character") });
  finishRead({});
  await tick();
  assert.match(page.status, /100% match with Newer Character/);
});

test("manual QuickCompare and group highlighting still work on the current page", async () => {
  const page = await openProfile(storageHub(snapshot({ 1: "yes" })), { 1: "yes" });
  const native = page.document.getElementById("native-quickcompare");
  let clicks = 0;
  native.addEventListener("click", event => {
    event.preventDefault();
    clicks++;
    page.kink(1).classList.remove("Character_QuickCompareYes");
    page.kink(1).classList.add("Character_QuickCompareNo", "Character_HighlightedFetish");
  });
  await page.click(native);
  assert.equal(clicks, 1);
  assert.ok(page.kink(1).classList.contains("Character_QuickCompareNo"));
  assert.ok(page.kink(1).classList.contains("Character_HighlightedFetish"));
  assert.match(page.status, /100% match with Saved Character/);
});
