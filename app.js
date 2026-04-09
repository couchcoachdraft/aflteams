// =========================
// CONFIG
// =========================
const DB_FILENAME = "aflplayers.json";
const SAVE_LOCAL_KEY = "afl-fantasy-builder-save-v1";

// editable in UI
let MAGIC_NUMBER = 9890;

// hardcoded team map
const SQUAD_ID_TO_TEAM = {
  10: "ADE", 20: "BRL", 30: "CAR", 40: "COL", 50: "ESS", 60: "FRE",
  70: "GEE", 80: "HAW", 90: "MEL", 100: "NTH", 110: "PTA", 120: "RIC",
  130: "STK", 140: "WBD", 150: "WCE", 160: "SYD", 1010: "GWS", 1000: "GCS",
};

const GROUPS_LEFT = [
  ["M", ["M1","M2","M3"]],
  ["HB", ["HB1","HB2"]],
  ["R", ["R"]],
  ["W", ["W1","W2"]],
	["HF", ["HF1","HF2"]],
];

const GROUPS_RIGHT = [
  ["Back", ["FB","CB","SB","UB"]],
  ["Forward", ["FF","CF","SF","UF"]],
  ["Bench", ["BB","BM","BW","BF","BU"]],
];

const RESERVES_COUNT = 15;
const ROOKIES_COUNT = 15;

// =========================
// STATE
// =========================
// playerDb: id -> playerRecord
let playerDb = {};
// teams: teamCode -> [playerId...]
let teams = {};

let currentTeam = null;

// per-team data:
// {
//   top: number|null,
//   roster: [playerId...],
//   injured: [playerId...],
//   main: {slotKey: {playerId: number|null, value: number}},
//   reserves: [{playerId}], rookies: [{playerId}],
// }
let teamState = {};

// =========================
// HELPERS
// =========================
function displayName(p) {
  return p.displayName || `${p.firstName || ""} ${p.lastName || ""}`.trim();
}
function posString(posArr) {
  if (!posArr) return "";
  if (!Array.isArray(posArr)) posArr = [posArr];
  return posArr.map(x => String(x).trim()).filter(Boolean).join("/");
}
function priceAt(price) {
  const n = Number(price);
  const m = Number(MAGIC_NUMBER);
  if (!Number.isFinite(n) || !Number.isFinite(m) || m === 0) return "";
  return (n / m).toFixed(1);
}
function uniq(arr) {
  return Array.from(new Set(arr));
}
function byName(a, b) {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}
function el(id) { return document.getElementById(id); }

function buildEmptyTeamState(rosterIds) {
  const main = {};
  [...GROUPS_LEFT, ...GROUPS_RIGHT].forEach(([_, slots]) => {
    slots.forEach(s => main[s] = { playerId: null, value: 0 });
  });
  return {
    top: null,
    roster: [...rosterIds],
    injured: [],
    main,
    reserves: Array.from({length: RESERVES_COUNT}, () => ({ playerId: null })),
    rookies: Array.from({length: ROOKIES_COUNT}, () => ({ playerId: null })),
  };
}

// =========================
// LOAD DB
// =========================
async function loadDb() {
  const res = await fetch(DB_FILENAME);
  if (!res.ok) throw new Error(`Failed to fetch ${DB_FILENAME}: ${res.status}`);
  const players = await res.json();
  if (!Array.isArray(players)) throw new Error(`${DB_FILENAME} must be a JSON array of players`);

  playerDb = {};
  teams = {};

  for (const p of players) {
    if (p == null) continue;
    const pid = Number(p.id);
    const squadId = Number(p.squadId);
    if (!Number.isFinite(pid) || !Number.isFinite(squadId)) continue;

    const team = SQUAD_ID_TO_TEAM[squadId] || String(squadId);
    const rec = {
      id: pid,
      squadId,
      team,
      firstName: p.firstName,
      lastName: p.lastName,
      displayName: `${p.firstName || ""} ${p.lastName || ""}`.trim(),
      price: p.price ?? "",
      priceAt: "", // computed later (depends on MAGIC_NUMBER)
      position: posString(p.position),
      games: p.gamesPlayed ?? "",
      average: p.averagePoints ?? "",
	  status: p.status ?? "",
      raw: p,
    };
    playerDb[pid] = rec;
    if (!teams[team]) teams[team] = [];
    teams[team].push(pid);
  }

  // sort rosters
  for (const t of Object.keys(teams)) {
    teams[t].sort((a, b) => displayName(playerDb[a]).localeCompare(displayName(playerDb[b])));
  }
}

// =========================
// RENDER
// =========================
function renderTabs() {
  const tabs = el("tabs");
  tabs.innerHTML = "";
  const teamCodes = Object.keys(teams).sort(byName);

  teamCodes.forEach(code => {
    const div = document.createElement("div");
    div.className = "tab" + (code === currentTeam ? " active" : "");
    div.textContent = code;
    div.onclick = () => selectTeam(code);
    tabs.appendChild(div);
  });
}

function renderTeamHeader() {
  el("teamTitle").textContent = currentTeam || "—";

  const t = teamState[currentTeam];
  el("topInput").value = t.top ?? "";
  el("topInput").oninput = () => {
    const v = el("topInput").value;
    t.top = v === "" ? null : Number(v);
    autosave();
    recalcTotals();
    renderMain(); // update %Top
  };

  recalcTotals();
}

function makeBox(title, gridClass) {
  const box = document.createElement("div");
  box.className = "box";
  const h = document.createElement("div");
  h.className = "boxTitle";
  h.textContent = title;
  box.appendChild(h);

  const grid = document.createElement("div");
  grid.className = "grid " + (gridClass || "");
  box.appendChild(grid);

  return { box, grid };
}

function addHdr(grid, labels) {
  labels.forEach(l => {
    const d = document.createElement("div");
    d.className = "hdr";
    d.textContent = l;
    grid.appendChild(d);
  });
}

function makeText(value, readonly=true) {
  const inp = document.createElement("input");
  inp.className = "cellInput";
  inp.value = value ?? "";
  if (readonly) inp.readOnly = true;
  return inp;
}

function makeDropInput(text, onDrop, onDragStartFromHere) {
  const inp = document.createElement("input");
  inp.className = "cellInput";
  inp.value = text || "";
  inp.readOnly = true;

  // drag from slot/res/rook to elsewhere
  inp.draggable = true;
  inp.addEventListener("dragstart", (e) => onDragStartFromHere(e));

  // allow drop onto it
  inp.addEventListener("dragover", (e) => { e.preventDefault(); inp.classList.add("dropHint"); });
  inp.addEventListener("dragleave", () => inp.classList.remove("dropHint"));
  inp.addEventListener("drop", (e) => { e.preventDefault(); inp.classList.remove("dropHint"); onDrop(e); });

  return inp;
}

function renderMain() {
  const leftCol = el("leftCol");
  const rightCol = el("rightCol");
  leftCol.innerHTML = "";
  rightCol.innerHTML = "";

  // LEFT groups
  GROUPS_LEFT.forEach(([gname, slots]) => {
    const { box, grid } = makeBox(gname);
    addHdr(grid, ["Slot","Player","Price","PriceAT","Pos","Games","Ave","Value","%Top"]);

    slots.forEach(slotKey => grid.append(...renderMainRow(slotKey)));
    leftCol.appendChild(box);
  });

  // Reserves embedded under left
  leftCol.appendChild(renderSecondary("Reserves (15)", "reserves", teamState[currentTeam].reserves, RESERVES_COUNT));

  // RIGHT groups
  GROUPS_RIGHT.forEach(([gname, slots]) => {
    const { box, grid } = makeBox(gname);
    addHdr(grid, ["Slot","Player","Price","PriceAT","Pos","Games","Ave","Value","%Top"]);
    slots.forEach(slotKey => grid.append(...renderMainRow(slotKey)));
    rightCol.appendChild(box);
  });

  // Rookies embedded under right
  rightCol.appendChild(renderSecondary("Rookies (15)", "rookies", teamState[currentTeam].rookies, ROOKIES_COUNT));

  renderPools();
}

function renderMainRow(slotKey) {
  const t = teamState[currentTeam];
  const row = [];

  // Slot label
  row.push(makeText(slotKey, true));

  const assigned = t.main[slotKey].playerId;
  const p = assigned != null ? playerDb[assigned] : null;

  const dropInp = makeDropInput(
    p ? displayName(p) : "",
    (e) => handleDropToMain(slotKey, e),
    (e) => handleDragStartFromAssigned("main", slotKey, e)
  );
	if (p && String(p.status).toLowerCase() === "playing") {
  	dropInp.classList.add("playingOutline");
}
  row.push(dropInp);

  row.push(makeText(p ? p.price : "", true));
  row.push(makeText(p ? priceAt(p.price) : "", true));
  row.push(makeText(p ? p.position : "", true));
  row.push(makeText(p ? p.games : "", true));
  row.push(makeText(p ? p.average : "", true));

  // Value input (editable)
  const valInp = document.createElement("input");
  valInp.className = "cellInput";
  valInp.type = "number";
  valInp.value = t.main[slotKey].value ?? 0;
  valInp.oninput = () => {
    t.main[slotKey].value = Number(valInp.value || 0);
    autosave();
    recalcTotals();
    renderMain(); // refresh %Top + total
  };
  row.push(valInp);

  // %Top
  const pct = computePctOfTop(t.main[slotKey].value);
  row.push(makeText(pct, true));

  return row;
}

function renderSecondary(title, kind, items, count) {
  const { box, grid } = makeBox(title, "small");
  addHdr(grid, ["#","Player","Price","PriceAT","Pos","Games","Ave"]);

  for (let i = 0; i < count; i++) {
    const item = items[i] || { playerId: null };
    const pid = item.playerId;
    const p = pid != null ? playerDb[pid] : null;

    grid.appendChild(makeText(String(i+1), true));

    const dropInp = makeDropInput(
      p ? displayName(p) : "",
      (e) => handleDropToSecondary(kind, i, e),
      (e) => handleDragStartFromAssigned(kind, i, e)
    );
	  if (p && String(p.status).toLowerCase() === "playing") {
      dropInp.classList.add("playingOutline");
}
    grid.appendChild(dropInp);

    grid.appendChild(makeText(p ? p.price : "", true));
    grid.appendChild(makeText(p ? priceAt(p.price) : "", true));
    grid.appendChild(makeText(p ? p.position : "", true));
    grid.appendChild(makeText(p ? p.games : "", true));
    grid.appendChild(makeText(p ? p.average : "", true));
  }

  return box;
}

function renderPools() {
  const t = teamState[currentTeam];

  renderPoolList(el("rosterPool"), t.roster, "roster");
  renderPoolList(el("injuredPool"), t.injured, "injured");

  // allow drop onto pools (to return/send)
  ["rosterPool","injuredPool"].forEach(id => {
    const ul = el(id);
    ul.addEventListener("dragover", (e) => { e.preventDefault(); ul.classList.add("dropHint"); });
    ul.addEventListener("dragleave", () => ul.classList.remove("dropHint"));
    ul.addEventListener("drop", (e) => {
      e.preventDefault(); ul.classList.remove("dropHint");
      handleDropToPool(ul.dataset.pool, e);
    });
  });
}

function renderPoolList(ul, ids, poolName) {
  ul.innerHTML = "";
  ids
    .map(pid => playerDb[pid])
    .filter(Boolean)
    .sort((a,b) => displayName(a).localeCompare(displayName(b)))
    .forEach(p => {
      const li = document.createElement("li");
      li.className = "poolItem";
      li.textContent = displayName(p);
      li.draggable = true;
      li.addEventListener("dragstart", (e) => handleDragStartFromPool(poolName, p.id, e));
      ul.appendChild(li);
    });
}

// =========================
// DRAG/DROP LOGIC
// =========================
function setDragData(e, payload) {
  e.dataTransfer.setData("application/json", JSON.stringify(payload));
  e.dataTransfer.effectAllowed = "move";
}

function getDragData(e) {
  try {
    return JSON.parse(e.dataTransfer.getData("application/json"));
  } catch {
    return null;
  }
}

function handleDragStartFromPool(poolName, playerId, e) {
  setDragData(e, { from: "pool", pool: poolName, playerId });
}

function handleDragStartFromAssigned(area, key, e) {
  // area: "main" | "reserves" | "rookies"
  const t = teamState[currentTeam];
  let pid = null;

  if (area === "main") pid = t.main[key].playerId;
  if (area === "reserves") pid = t.reserves[key].playerId;
  if (area === "rookies") pid = t.rookies[key].playerId;

  if (pid == null) {
    e.preventDefault();
    return;
  }
  setDragData(e, { from: "assigned", area, key, playerId: pid });
}

function removeFromPool(t, pool, playerId) {
  t[pool] = t[pool].filter(x => x !== playerId);
}

function addToPool(t, pool, playerId) {
  if (!t[pool].includes(playerId)) t[pool].push(playerId);
}

function clearAssigned(t, area, key) {
  if (area === "main") t.main[key].playerId = null;
  if (area === "reserves") t.reserves[key].playerId = null;
  if (area === "rookies") t.rookies[key].playerId = null;
}

function getAssigned(t, area, key) {
  if (area === "main") return t.main[key].playerId;
  if (area === "reserves") return t.reserves[key].playerId;
  if (area === "rookies") return t.rookies[key].playerId;
  return null;
}

function setAssigned(t, area, key, playerId) {
  // if target already has someone, return them to roster
  const existing = getAssigned(t, area, key);
  if (existing != null && existing !== playerId) addToPool(t, "roster", existing);

  if (area === "main") t.main[key].playerId = playerId;
  if (area === "reserves") t.reserves[key].playerId = playerId;
  if (area === "rookies") t.rookies[key].playerId = playerId;
}

function handleDropToMain(slotKey, e) {
  const payload = getDragData(e);
  if (!payload) return;
  const t = teamState[currentTeam];
  const pid = payload.playerId;

  // assign
  setAssigned(t, "main", slotKey, pid);

  // if coming from pool, remove from that pool
  if (payload.from === "pool") removeFromPool(t, payload.pool, pid);

  // if coming from assigned elsewhere, clear source
  if (payload.from === "assigned") {
    if (!(payload.area === "main" && payload.key === slotKey)) {
      clearAssigned(t, payload.area, payload.key);
    }
  }

  autosave();
  recalcTotals();
  renderMain();
}

function handleDropToSecondary(kind, index, e) {
  const payload = getDragData(e);
  if (!payload) return;
  const t = teamState[currentTeam];
  const pid = payload.playerId;

  setAssigned(t, kind, index, pid);

  if (payload.from === "pool") removeFromPool(t, payload.pool, pid);

  if (payload.from === "assigned") {
    if (!(payload.area === kind && payload.key === index)) {
      clearAssigned(t, payload.area, payload.key);
    }
  }

  autosave();
  recalcTotals();
  renderMain();
}

function handleDropToPool(poolName, e) {
  const payload = getDragData(e);
  if (!payload) return;
  const t = teamState[currentTeam];
  const pid = payload.playerId;

  // move into pool
  addToPool(t, poolName, pid);

  // remove from other pool if needed
  if (poolName === "roster") removeFromPool(t, "injured", pid);
  if (poolName === "injured") removeFromPool(t, "roster", pid);

  // if coming from assigned, clear source
  if (payload.from === "assigned") clearAssigned(t, payload.area, payload.key);

  autosave();
  recalcTotals();
  renderMain();
}

// =========================
// TOTALS
// =========================
function computePctOfTop(value) {
  const t = teamState[currentTeam];
  const top = t.top;
  if (!Number.isFinite(top) || top <= 0) return "—";
  return ((Number(value || 0) / top) * 100).toFixed(1) + "%";
}

function recalcTotals() {
  const t = teamState[currentTeam];
  const top = t.top;
  const total = Object.values(t.main).reduce((acc, r) => acc + Number(r.value || 0), 0);

  el("totalLabel").textContent = `Total: ${total.toFixed(0)} / ${top ?? 0}`;
  if (Number.isFinite(top) && top > 0) {
    el("remainingLabel").textContent = `Remaining: ${(top - total).toFixed(0)}`;
    el("totalLabel").style.color = Math.abs(top - total) < 1e-9 ? "red" : "";
  } else {
    el("remainingLabel").textContent = "Remaining: —";
    el("totalLabel").style.color = "";
  }
}

// =========================
// TEAM SELECT
// =========================
function selectTeam(code) {
  currentTeam = code;
  if (!teamState[code]) teamState[code] = buildEmptyTeamState(teams[code]);
  renderTabs();
  renderTeamHeader();
  renderMain();
}

// =========================
// SAVE / LOAD
// =========================
function autosave() {
  const payload = {
    magicNumber: MAGIC_NUMBER,
    teamState,
    currentTeam
  };
  localStorage.setItem(SAVE_LOCAL_KEY, JSON.stringify(payload));
}

function loadAutosaveIfAny() {
  const s = localStorage.getItem(SAVE_LOCAL_KEY);
  if (!s) return false;
  try {
    const data = JSON.parse(s);
    if (typeof data.magicNumber === "number") MAGIC_NUMBER = data.magicNumber;
    if (data.teamState) teamState = data.teamState;
    if (data.currentTeam) currentTeam = data.currentTeam;
    return true;
  } catch {
    return false;
  }
}

function exportSaveToFile() {
  const payload = {
    magicNumber: MAGIC_NUMBER,
    teamState,
    currentTeam,
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
	a.href = url;
	a.download = "afl-fantasy-save.json";
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

function importSaveFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);

      if (typeof data.magicNumber === "number") {
        MAGIC_NUMBER = data.magicNumber;
        el("magicNumber").value = MAGIC_NUMBER;
      }

      if (data.teamState && typeof data.teamState === "object") {
        teamState = data.teamState;
      }

      // Ensure any missing teams are created
      for (const code of Object.keys(teams)) {
        if (!teamState[code]) teamState[code] = buildEmptyTeamState(teams[code]);
      }

      currentTeam = data.currentTeam && teams[data.currentTeam] ? data.currentTeam : Object.keys(teams)[0];

      autosave();
      renderTabs();
      selectTeam(currentTeam);
    } catch (e) {
      alert("Import failed: " + e);
    }
  };
  reader.readAsText(file);
}

function clearAutosave() {
  localStorage.removeItem(SAVE_LOCAL_KEY);
  alert("Browser autosave cleared.");
}

// =========================
// INIT
// =========================
async function init() {
  // magic number UI
  el("magicNumber").value = MAGIC_NUMBER;
  el("magicNumber").oninput = () => {
    MAGIC_NUMBER = Number(el("magicNumber").value || 0);
    autosave();
    renderMain(); // updates PriceAT display
  };

  // export/import buttons
  el("btnExport").onclick = exportSaveToFile;
  el("btnImport").onclick = () => el("fileImport").click();
  el("fileImport").onchange = (e) => {
    const file = e.target.files?.[0];
    if (file) importSaveFromFile(file);
    e.target.value = "";
  };

  el("btnClearLocal").onclick = clearAutosave;

  // load DB
  try {
  await loadDb();
} catch (e) {
  document.body.innerHTML = `<pre style="color:white;background:#111;padding:16px;">DB load failed:\n${String(e)}\n\nCheck:\n- run via http:// not file://\n- aflplayers.json path/name\n- valid JSON</pre>`;
  throw e;
}

  // load autosave if present
  loadAutosaveIfAny();

  // Ensure states exist for each team
  for (const code of Object.keys(teams)) {
    if (!teamState[code]) teamState[code] = buildEmptyTeamState(teams[code]);
  }

  // pick team
  if (!currentTeam || !teams[currentTeam]) {
    currentTeam = Object.keys(teams).sort(byName)[0];
  }

  renderTabs();
  selectTeam(currentTeam);
}

init();

