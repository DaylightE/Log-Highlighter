(() => {
  if (!/^\/c\/[^/]+\/?$/i.test(location.pathname) || document.getElementById("fhl-kink-comparison")) return;

  const extension = globalThis.browser || globalThis.chrome;
  const header = document.getElementById("Character_FetishFilterHeader");
  const list = document.getElementById("Character_FetishList");
  if (!extension?.storage?.local || !header || !list) return;

  const STORE_KEY = "fhlKinkComparisonProfile";
  const categories = {
    fave: "Fave",
    yes: "Yes",
    maybe: "Maybe",
    no: "No"
  };
  const compareClasses = ["Character_QuickCompareActive", ...Object.values(categories).map(category => `Character_QuickCompare${category}`)];

  function readProfile() {
    const name = document.getElementById("profile-character-name")?.value?.trim();
    const characterId = document.getElementById("profile-character-id")?.value;
    if (!name || !/^\d+$/.test(characterId || "")) return null;

    const kinks = {};
    for (const [choice, category] of Object.entries(categories)) {
      // Standard subkinks inside a custom group inherit that group's category,
      // even when the group is collapsed. Custom kink IDs are profile-specific.
      const column = list.querySelector(`#Character_Fetishlist${category}`);
      for (const element of column?.querySelectorAll(".Character_ListedFetish[id]") || []) {
        const id = element.id.match(/^Character_ListedFetish(\d+)$/)?.[1];
        if (id) kinks[id] = choice;
      }
    }
    return { version: 1, name, characterId, kinks };
  }

  function validateSnapshot(value) {
    if (!value || value.version !== 1 || typeof value.name !== "string" || !value.name.trim() ||
        typeof value.characterId !== "string" || !/^\d+$/.test(value.characterId) ||
        !value.kinks || typeof value.kinks !== "object" || Array.isArray(value.kinks)) return null;
    const entries = Object.entries(value.kinks);
    if (!entries.length || entries.some(([id, choice]) => !/^\d+$/.test(id) || typeof choice !== "string" || !Object.hasOwn(categories, choice))) return null;
    return { version: 1, name: value.name, characterId: value.characterId, kinks: Object.fromEntries(entries) };
  }

  if (!readProfile()) return;

  const controls = document.createElement("span");
  controls.id = "fhl-kink-comparison";
  controls.style.cssText = "display:inline-flex;align-items:baseline;flex-wrap:wrap;gap:6px;margin-left:8px;vertical-align:baseline;";

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = "(Staff) Save kinks for comparison";
  saveButton.id = "fhl-save-kinks";
  saveButton.title = "Save this character's current standard kink categories in this browser and automatically compare future profiles with them.";
  controls.appendChild(saveButton);
  const status = document.createElement("span");
  status.id = "fhl-kink-comparison-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  controls.appendChild(status);
  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.textContent = "Clear saved";
  clearButton.id = "fhl-clear-kinks";
  clearButton.title = "Remove the saved character and stop automatic kink comparison.";
  controls.appendChild(clearButton);

  // QuickCompare is available when signed in. Public profiles still get the
  // controls in the same header, alongside the site's kink highlighting menu.
  const quickCompare = Array.from(header.querySelectorAll("a, button, input")).find(element =>
    /^quick\s*compare[!:]?$/i.test((element.textContent || element.value || "").trim())
  ) || header.querySelector("#Character_QuickCompareButton");
  if (quickCompare) quickCompare.insertAdjacentElement("afterend", controls);
  else header.appendChild(controls);

  let savedProfile = null;
  let busy = true;
  let error = "";
  let storageRevision = 0;
  const highlighted = new Set();

  function clearHighlights() {
    for (const element of highlighted) element.classList.remove(...compareClasses);
    highlighted.clear();
  }

  function applyComparison(profile) {
    clearHighlights();
    if (!savedProfile) return { matches: 0, shared: 0 };
    let matches = 0;
    let shared = 0;
    for (const element of list.querySelectorAll(".Character_ListedFetish[id]")) {
      const id = element.id.match(/^Character_ListedFetish(\d+)$/)?.[1];
      element.classList.remove(...compareClasses);
      const choice = savedProfile.kinks[id];
      if (choice) {
        element.classList.add("Character_QuickCompareActive", `Character_QuickCompare${categories[choice]}`);
        highlighted.add(element);
      }
    }
    for (const [id, choice] of Object.entries(profile.kinks)) {
      if (!Object.hasOwn(savedProfile.kinks, id)) continue;
      shared++;
      if (savedProfile.kinks[id] === choice) matches++;
    }
    return { matches, shared };
  }

  function render() {
    const profile = readProfile();
    const canSave = profile && Object.keys(profile.kinks).length > 0;
    saveButton.disabled = busy || !canSave;
    clearButton.hidden = !savedProfile;
    clearButton.disabled = busy;
    status.replaceChildren();
    status.title = "";
    if (busy) {
      status.textContent = "Loading saved comparison...";
      return;
    }
    const { matches, shared } = applyComparison(profile || { kinks: {} });
    if (error) {
      status.textContent = error;
    } else if (savedProfile) {
      const percentage = shared ? `${Math.round(matches / shared * 1000) / 10}%` : "N/A";
      status.append(`${percentage} match with `);
      const link = document.createElement("a");
      link.href = `/c/${encodeURIComponent(savedProfile.name)}`;
      link.textContent = savedProfile.name;
      status.append(link, shared ? ` (${matches}/${shared} shared kinks)` : " (no shared kinks)");
      status.title = "Exact category matches / standard kinks listed by both profiles. Fave, Yes, Maybe, and No must match exactly. Unlisted kinks and custom kink names are excluded; standard subkinks are included. QuickCompare colors show the saved character's categories. Manual QuickCompare can override the colors on this page.";
    } else {
      status.textContent = canSave ? "Save a profile to compare future profiles." : "No standard kinks to save on this profile.";
    }
  }

  saveButton.addEventListener("click", async () => {
    const profile = readProfile();
    if (busy || !profile || !Object.keys(profile.kinks).length) return;
    busy = true;
    error = "";
    saveButton.disabled = clearButton.disabled = true;
    status.textContent = "Saving kinks...";
    try {
      await extension.storage.local.set({ [STORE_KEY]: profile });
      savedProfile = profile;
    } catch {
      error = "Could not save kinks. Try again.";
    } finally {
      busy = false;
      render();
    }
  });

  clearButton.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    error = "";
    saveButton.disabled = clearButton.disabled = true;
    status.textContent = "Clearing saved kinks...";
    try {
      await extension.storage.local.remove(STORE_KEY);
      savedProfile = null;
    } catch {
      error = "Could not clear saved kinks. Try again.";
    } finally {
      busy = false;
      render();
    }
  });

  extension.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !Object.hasOwn(changes, STORE_KEY)) return;
    storageRevision++;
    savedProfile = validateSnapshot(changes[STORE_KEY].newValue);
    error = "";
    render();
  });

  render();
  const initialRevision = storageRevision;
  extension.storage.local.get(STORE_KEY).then(values => {
    if (storageRevision === initialRevision) savedProfile = validateSnapshot(values[STORE_KEY]);
  }).catch(() => {
    error = "Could not load the saved comparison. Reload this page or save a profile again.";
  }).finally(() => {
    busy = false;
    render();
  });
})();
