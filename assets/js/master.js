import {
  CONFIG,
  bidSummary,
  canonicalName,
  cleanName,
  downloadText,
  formatCredits,
  loadPaintings,
  parseSubmissionsFromText,
  readJSON,
  validateSubmission,
  writeJSON,
} from "./shared.js";

let paintings = [];
let submissions = [];
let editingName = null;

const elements = {
  paste: document.querySelector("#submissionInput"),
  parse: document.querySelector("#parseSubmissions"),
  clearPaste: document.querySelector("#clearPaste"),
  parseMessages: document.querySelector("#parseMessages"),
  seed: document.querySelector("#auctionSeed"),
  run: document.querySelector("#runAuction"),
  backup: document.querySelector("#downloadBackup"),
  auctionStatus: document.querySelector("#auctionStatus"),
  rows: document.querySelector("#participantRows"),
  newManual: document.querySelector("#newManualEntry"),
  editor: document.querySelector("#manualEditor"),
  editorTitle: document.querySelector("#editorTitle"),
  editorName: document.querySelector("#editorName"),
  editorGrid: document.querySelector("#editorGrid"),
  editorSummary: document.querySelector("#editorSummary"),
  editorMessage: document.querySelector("#editorMessage"),
  saveEditor: document.querySelector("#saveManualEntry"),
  deleteEditor: document.querySelector("#deleteManualEntry"),
  closeEditor: document.querySelector("#closeEditor"),
};

init();

async function init() {
  try {
    paintings = await loadPaintings();
    submissions = readJSON(CONFIG.storage.submissions, []);
    elements.seed.value = localStorage.getItem(CONFIG.storage.seed) || elements.seed.value;
    bindEvents();
    renderParticipants();
    renderEditorGrid();
  } catch (error) {
    elements.auctionStatus.textContent = error.message;
    elements.auctionStatus.className = "validation-message error";
  }
}

function bindEvents() {
  elements.parse.addEventListener("click", addPastedSubmissions);
  elements.clearPaste.addEventListener("click", () => {
    elements.paste.value = "";
    elements.parseMessages.innerHTML = "";
  });
  elements.run.addEventListener("click", runAuction);
  elements.backup.addEventListener("click", downloadBackup);
  elements.newManual.addEventListener("click", () => openEditor(null));
  elements.saveEditor.addEventListener("click", saveEditor);
  elements.deleteEditor.addEventListener("click", deleteEditor);
  elements.closeEditor.addEventListener("click", closeEditor);
  elements.seed.addEventListener("input", () => localStorage.setItem(CONFIG.storage.seed, elements.seed.value));
  elements.editorName.addEventListener("input", updateEditorSummary);
}

async function addPastedSubmissions() {
  const parsed = await parseSubmissionsFromText(elements.paste.value, paintings);
  const messages = [];

  for (const submission of parsed.submissions) {
    upsertSubmission(submission);
    messages.push({ type: "ok", text: `${submission.name} added.` });
  }
  for (const warning of parsed.warnings) {
    messages.push({ type: "warn", text: warning });
  }
  for (const error of parsed.errors) {
    messages.push({ type: "error", text: error });
  }

  persistSubmissions();
  renderParticipants();
  renderMessages(messages);
}

function upsertSubmission(submission) {
  const key = canonicalName(submission.name);
  const existingIndex = submissions.findIndex((entry) => canonicalName(entry.name) === key);
  const normalized = {
    name: cleanName(submission.name),
    bids: submission.bids,
    createdAt: submission.createdAt || new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    submissions[existingIndex] = normalized;
  } else {
    submissions.push(normalized);
  }
  submissions.sort((left, right) => left.name.localeCompare(right.name));
}

function renderMessages(messages) {
  elements.parseMessages.innerHTML = "";
  for (const message of messages) {
    const node = document.createElement("p");
    node.className = message.type === "error" ? "validation-message error" : "validation-message ok";
    node.textContent = message.text;
    elements.parseMessages.append(node);
  }
}

function renderParticipants() {
  elements.rows.innerHTML = "";
  if (submissions.length === 0) {
    elements.rows.innerHTML = '<tr><td colspan="5" class="muted">No submissions yet.</td></tr>';
    elements.run.disabled = true;
    return;
  }

  elements.run.disabled = false;
  for (const submission of submissions) {
    const validation = validateSubmission(submission.name, paintings, submission.bids);
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><strong>${submission.name}</strong></td>
      <td>${formatCredits(validation.summary.total)}</td>
      <td>${validation.summary.distinct}</td>
      <td><span class="status-pill ${validation.valid ? "" : "bad"}">${validation.valid ? "Valid" : "Needs fix"}</span></td>
      <td>
        <div class="row-actions">
          <button class="secondary-button" type="button" data-action="edit">Edit</button>
          <button class="danger-button" type="button" data-action="delete">Delete</button>
        </div>
      </td>
    `;
    row.querySelector('[data-action="edit"]').addEventListener("click", () => openEditor(submission.name));
    row.querySelector('[data-action="delete"]').addEventListener("click", () => {
      submissions = submissions.filter((entry) => canonicalName(entry.name) !== canonicalName(submission.name));
      persistSubmissions();
      renderParticipants();
      if (editingName && canonicalName(editingName) === canonicalName(submission.name)) {
        closeEditor();
      }
    });
    elements.rows.append(row);
  }
}

function renderEditorGrid() {
  elements.editorGrid.innerHTML = "";
  for (const painting of paintings) {
    const row = document.createElement("label");
    row.className = "editor-row";
    row.innerHTML = `
      <span>#${painting.id} ${painting.name}</span>
      <input class="credit-input" type="number" inputmode="numeric" min="0" max="${CONFIG.maxPerPainting}" step="1" data-painting-id="${painting.id}">
    `;
    row.querySelector("input").addEventListener("input", updateEditorSummary);
    elements.editorGrid.append(row);
  }
}

function openEditor(name) {
  editingName = name;
  const submission = name ? submissions.find((entry) => canonicalName(entry.name) === canonicalName(name)) : null;
  elements.editor.hidden = false;
  elements.editorTitle.textContent = submission ? `Edit ${submission.name}` : "Manual Entry";
  elements.editorName.value = submission?.name || "";
  elements.deleteEditor.hidden = !submission;
  for (const input of elements.editorGrid.querySelectorAll("input")) {
    const value = Number(submission?.bids?.[input.dataset.paintingId] ?? 0) || 0;
    input.value = value > 0 ? String(value) : "";
  }
  updateEditorSummary();
  elements.editor.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeEditor() {
  editingName = null;
  elements.editor.hidden = true;
  elements.editorMessage.textContent = "";
}

function editorBids() {
  const bids = {};
  for (const input of elements.editorGrid.querySelectorAll("input")) {
    bids[input.dataset.paintingId] = Number(input.value) || 0;
  }
  return bids;
}

function updateEditorSummary() {
  const summary = bidSummary(paintings, editorBids());
  const remaining = CONFIG.totalCredits - summary.total;
  elements.editorSummary.innerHTML = `
    <div><span class="metric-label">Remaining</span><strong>${formatCredits(remaining)}</strong></div>
    <div><span class="metric-label">Allocated</span><strong>${formatCredits(summary.total)}</strong></div>
    <div><span class="metric-label">Paintings</span><strong>${summary.distinct}</strong></div>
  `;
}

function saveEditor() {
  const name = cleanName(elements.editorName.value);
  const bids = editorBids();
  const validation = validateSubmission(name, paintings, bids);
  if (!validation.valid) {
    elements.editorMessage.textContent = validation.errors.join(" ");
    elements.editorMessage.className = "validation-message error";
    return;
  }

  if (editingName && canonicalName(editingName) !== canonicalName(name)) {
    submissions = submissions.filter((entry) => canonicalName(entry.name) !== canonicalName(editingName));
  }
  upsertSubmission({ name, bids: validation.summary.normalized });
  persistSubmissions();
  renderParticipants();
  openEditor(name);
  elements.editorMessage.textContent = "Entry saved.";
  elements.editorMessage.className = "validation-message ok";
}

function deleteEditor() {
  if (!editingName) {
    return;
  }
  submissions = submissions.filter((entry) => canonicalName(entry.name) !== canonicalName(editingName));
  persistSubmissions();
  renderParticipants();
  closeEditor();
}

function persistSubmissions() {
  writeJSON(CONFIG.storage.submissions, submissions);
}

function validSubmissions() {
  return submissions.filter((submission) => validateSubmission(submission.name, paintings, submission.bids).valid);
}

function runAuction() {
  const valid = validSubmissions();
  if (valid.length !== submissions.length || valid.length === 0) {
    elements.auctionStatus.textContent = "Every participant must have a valid entry before running the auction.";
    elements.auctionStatus.className = "validation-message error";
    return;
  }

  const seed = cleanName(elements.seed.value) || "papi-art-2026";
  const auction = {
    id: `auction-${Date.now()}`,
    createdAt: new Date().toISOString(),
    seed,
    paintings,
    submissions: valid,
    config: {
      totalCredits: CONFIG.totalCredits,
      maxPerPainting: CONFIG.maxPerPainting,
      minPaintings: CONFIG.minPaintings,
    },
  };
  writeJSON(CONFIG.storage.auction, auction);
  localStorage.removeItem(CONFIG.storage.results);
  localStorage.setItem(CONFIG.storage.seed, seed);
  window.location.href = "results.html";
}

function downloadBackup() {
  const backup = {
    savedAt: new Date().toISOString(),
    seed: elements.seed.value,
    submissions,
  };
  downloadText("papi-art-submissions-backup.json", JSON.stringify(backup, null, 2));
}
