import {
  CONFIG,
  bidSummary,
  cleanName,
  formatCredits,
  loadPaintings,
  makeSubmissionToken,
  readJSON,
  validateSubmission,
  writeJSON,
} from "./shared.js";

let paintings = [];
let bids = {};
let zoom = 1;
const desktopSummaryQuery = window.matchMedia("(min-width: 921px)");

const elements = {
  header: document.querySelector(".participant-topbar"),
  summary: document.querySelector("#participantSummary"),
  desktopSummarySlot: document.querySelector("#desktopSummarySlot"),
  mobileSummarySlot: document.querySelector("#mobileSummarySlot"),
  name: document.querySelector("#participantName"),
  remaining: document.querySelector("#remainingCredits"),
  allocated: document.querySelector("#allocatedCredits"),
  selected: document.querySelector("#selectedCount"),
  validation: document.querySelector("#validationMessage"),
  list: document.querySelector("#paintingList"),
  copy: document.querySelector("#copySubmission"),
  clear: document.querySelector("#clearBids"),
  strip: document.querySelector("#selectionStrip"),
  output: document.querySelector("#submissionOutput"),
  modal: document.querySelector("#imageModal"),
  modalTitle: document.querySelector("#modalTitle"),
  modalMeta: document.querySelector("#modalMeta"),
  modalImage: document.querySelector("#modalImage"),
  modalWrap: document.querySelector("#modalImageWrap"),
  closeModal: document.querySelector("#closeModal"),
  zoomOut: document.querySelector("#zoomOut"),
  zoomReset: document.querySelector("#zoomReset"),
  zoomIn: document.querySelector("#zoomIn"),
};

init();

async function init() {
  try {
    paintings = await loadPaintings();
    const draft = readJSON(CONFIG.storage.draft, {});
    elements.name.value = cleanName(draft.name || "");
    bids = {};
    for (const painting of paintings) {
      bids[painting.id] = Number(draft.bids?.[painting.id] ?? 0) || 0;
    }
    renderPaintings();
    bindEvents();
    placeSummary();
    syncStickyOffset();
    updateState();
  } catch (error) {
    elements.list.innerHTML = `<p class="validation-message error">${error.message}</p>`;
  }
}

function bindEvents() {
  if ("ResizeObserver" in window) {
    new ResizeObserver(syncStickyOffset).observe(elements.header);
  } else {
    window.addEventListener("resize", syncStickyOffset);
  }
  if (desktopSummaryQuery.addEventListener) {
    desktopSummaryQuery.addEventListener("change", placeSummary);
  } else {
    desktopSummaryQuery.addListener(placeSummary);
  }
  elements.name.addEventListener("input", () => {
    persistDraft();
    updateState();
  });
  elements.copy.addEventListener("click", copySubmission);
  elements.clear.addEventListener("click", clearAllBids);
  elements.closeModal.addEventListener("click", closeImageModal);
  elements.modal.addEventListener("click", (event) => {
    if (event.target === elements.modal) {
      closeImageModal();
    }
  });
  elements.zoomOut.addEventListener("click", () => setZoom(Math.max(0.5, zoom - 0.25)));
  elements.zoomReset.addEventListener("click", () => setZoom(1));
  elements.zoomIn.addEventListener("click", () => setZoom(Math.min(4, zoom + 0.25)));
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.modal.hidden) {
      closeImageModal();
    }
  });
}

function placeSummary() {
  const target = desktopSummaryQuery.matches ? elements.desktopSummarySlot : elements.mobileSummarySlot;
  if (!target || !elements.summary) {
    return;
  }
  if (elements.summary.parentElement !== target) {
    target.append(elements.summary);
  }
  syncStickyOffset();
}

function renderPaintings() {
  elements.list.innerHTML = "";
  for (const painting of paintings) {
    const card = document.createElement("article");
    card.className = "painting-card";
    card.innerHTML = `
      <button class="painting-thumb-button" type="button" aria-label="Open ${painting.name} image">
        <img src="${painting.image}" alt="${painting.name}" loading="lazy">
      </button>
      <div>
        <div class="painting-title-row">
          <span class="painting-number">#${painting.id}</span>
          <h2>${painting.name}</h2>
        </div>
        <p class="painting-meta">${painting.dimensions}${painting.year ? ` | ${painting.year}` : ""}</p>
        <details>
          <summary>Description</summary>
          <p>${painting.description || "No description available."}</p>
        </details>
      </div>
      <div class="bid-block">
        <label for="bid-${painting.id}">Credits</label>
        <input id="bid-${painting.id}" class="credit-input" type="number" inputmode="numeric" min="0" max="${CONFIG.maxPerPainting}" step="1" value="${bids[painting.id] || ""}" data-painting-id="${painting.id}">
      </div>
    `;

    card.querySelector(".painting-thumb-button").addEventListener("click", () => openImageModal(painting));
    card.querySelector(".credit-input").addEventListener("input", (event) => {
      const value = Number(event.target.value);
      bids[painting.id] = Number.isFinite(value) ? value : 0;
      persistDraft();
      updateState();
    });
    elements.list.append(card);
  }
}

function updateState() {
  const validation = validateSubmission(elements.name.value, paintings, bids);
  const total = validation.summary.total;
  const remaining = CONFIG.totalCredits - total;
  elements.remaining.textContent = formatCredits(remaining);
  elements.allocated.textContent = formatCredits(total);
  elements.selected.textContent = String(validation.summary.distinct);
  elements.copy.disabled = !validation.valid;

  setMetricState(elements.remaining, Math.abs(remaining) < 1e-9);
  setMetricState(elements.allocated, Math.abs(total - CONFIG.totalCredits) < 1e-9);
  setMetricState(elements.selected, validation.summary.distinct >= Math.min(CONFIG.minPaintings, paintings.length));
  renderSelectionStrip(validation.summary.normalized);

  if (validation.valid) {
    elements.validation.textContent = "Ready to copy.";
    elements.validation.className = "validation-message ok";
  } else {
    elements.validation.innerHTML = `
      <span>Please correct the following before submitting your choices:</span>
      <ul>${validation.errors.map((error) => `<li>${error}</li>`).join("")}</ul>
    `;
    elements.validation.className = "validation-message error";
  }
  syncStickyOffset();
}

function setMetricState(element, valid) {
  element.classList.toggle("metric-good", valid);
  element.classList.toggle("metric-bad", !valid);
}

function renderSelectionStrip(normalized) {
  const selected = paintings
    .filter((painting) => normalized[painting.id] > 0)
    .map((painting) => ({ painting, credits: normalized[painting.id] }));

  if (selected.length === 0) {
    elements.strip.innerHTML = '<span class="muted">No credits allocated yet.</span>';
    return;
  }

  elements.strip.innerHTML = "";
  for (const entry of selected) {
    const chip = document.createElement("span");
    chip.className = "selection-chip";
    chip.innerHTML = `<span>#${entry.painting.id} ${entry.painting.name}</span><strong>${formatCredits(entry.credits)}</strong>`;
    elements.strip.append(chip);
  }
}

async function copySubmission() {
  const validation = validateSubmission(elements.name.value, paintings, bids);
  if (!validation.valid) {
    updateState();
    return;
  }

  const token = await makeSubmissionToken(elements.name.value, paintings, validation.summary.normalized);
  elements.output.value = token;
  elements.output.style.display = "block";

  try {
    await navigator.clipboard.writeText(token);
    elements.validation.textContent = "Copied. Paste this into a text message to the auction master.";
    elements.validation.className = "validation-message ok";
  } catch {
    elements.output.focus();
    elements.output.select();
    elements.validation.textContent = "Clipboard access was blocked. Select and copy the data shown below.";
    elements.validation.className = "validation-message error";
  }
  syncStickyOffset();
}

function clearAllBids() {
  bids = Object.fromEntries(paintings.map((painting) => [painting.id, 0]));
  for (const input of document.querySelectorAll(".credit-input")) {
    input.value = "";
  }
  persistDraft();
  updateState();
}

function persistDraft() {
  writeJSON(CONFIG.storage.draft, {
    name: cleanName(elements.name.value),
    bids,
  });
}

function openImageModal(painting) {
  zoom = 1;
  elements.modalTitle.textContent = `#${painting.id} ${painting.name}`;
  elements.modalMeta.textContent = `${painting.dimensions}${painting.year ? ` | ${painting.year}` : ""}`;
  elements.modalImage.src = painting.image;
  elements.modalImage.alt = painting.name;
  elements.modal.hidden = false;
  setZoom(1);
}

function closeImageModal() {
  elements.modal.hidden = true;
  elements.modalImage.src = "";
}

function setZoom(nextZoom) {
  zoom = nextZoom;
  if (zoom === 1) {
    elements.modalImage.style.width = "";
    elements.modalImage.style.maxWidth = "min(100%, 1500px)";
    elements.modalImage.style.maxHeight = "78vh";
    elements.modalWrap.scrollTo({ top: 0, left: 0 });
    return;
  }
  elements.modalImage.style.width = `${Math.round(zoom * 100)}%`;
  elements.modalImage.style.maxWidth = "none";
  elements.modalImage.style.maxHeight = "none";
}

function syncStickyOffset() {
  if (!elements.header) {
    return;
  }
  document.documentElement.style.setProperty("--participant-topbar-height", `${Math.ceil(elements.header.offsetHeight)}px`);
}
