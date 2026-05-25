import {
  CONFIG,
  allocatePaintings,
  canonicalName,
  comparePaintingIds,
  formatCredits,
  imagePath,
  popularityByPainting,
  readJSON,
  revealOrder,
  writeJSON,
} from "./shared.js";

let auction = null;
let state = null;
let orderedPaintings = [];
let popularity = {};
let allocation = null;
let winnerVisible = false;

const elements = {
  noAuction: document.querySelector("#noAuction"),
  stage: document.querySelector("#resultsStage"),
  progress: document.querySelector("#progressCount"),
  accepted: document.querySelector("#acceptedCount"),
  optOutCount: document.querySelector("#optOutCount"),
  image: document.querySelector("#featureImage"),
  number: document.querySelector("#featureNumber"),
  name: document.querySelector("#featureName"),
  meta: document.querySelector("#featureMeta"),
  description: document.querySelector("#featureDescription"),
  topBidders: document.querySelector("#topBidderList"),
  winnerPanel: document.querySelector("#winnerPanel"),
  winnerName: document.querySelector("#winnerName"),
  primary: document.querySelector("#primaryResultAction"),
  optOut: document.querySelector("#optOutWinner"),
  summaryToggle: document.querySelector("#summaryToggle"),
  summary: document.querySelector("#summaryPanel"),
  closeSummary: document.querySelector("#closeSummary"),
  summaryRows: document.querySelector("#summaryRows"),
  message: document.querySelector("#resultMessage"),
};

init();

async function init() {
  auction = readJSON(CONFIG.storage.auction, null);
  if (!auction) {
    elements.noAuction.hidden = false;
    return;
  }

  state = readJSON(CONFIG.storage.results, null);
  if (!state || state.auctionId !== auction.id) {
    state = {
      auctionId: auction.id,
      currentIndex: 0,
      accepted: {},
      optOuts: [],
    };
    persistState();
  }

  orderedPaintings = revealOrder(auction.paintings, auction.submissions);
  popularity = popularityByPainting(auction.paintings, auction.submissions);
  bindEvents();
  await recomputeAndRender(false);
  elements.stage.hidden = false;
}

function bindEvents() {
  elements.primary.addEventListener("click", primaryAction);
  elements.optOut.addEventListener("click", optOutCurrentWinner);
  elements.summaryToggle.addEventListener("click", () => {
    elements.summary.hidden = false;
    renderSummary();
  });
  elements.closeSummary.addEventListener("click", () => {
    elements.summary.hidden = true;
  });
}

async function recomputeAndRender(keepWinnerVisible) {
  allocation = await allocatePaintings({
    paintings: auction.paintings,
    submissions: auction.submissions,
    seed: auction.seed,
    excludedAgents: state.optOuts,
    lockedAllocations: acceptedLocks(),
  });
  winnerVisible = keepWinnerVisible;
  renderCurrent();
  renderSummary();
}

function acceptedLocks() {
  return orderedPaintings
    .slice(0, state.currentIndex)
    .map((painting) => ({
      paintingId: painting.id,
      winnerName: state.accepted[painting.id] || null,
    }));
}

function currentPainting() {
  return orderedPaintings[state.currentIndex] || null;
}

function currentWinner() {
  const painting = currentPainting();
  if (!painting) {
    return null;
  }
  return allocation?.winnerByPainting?.[painting.id] || null;
}

function renderCurrent() {
  const painting = currentPainting();
  elements.accepted.textContent = String(Object.keys(state.accepted).length);
  elements.optOutCount.textContent = String(state.optOuts.length);

  if (!painting) {
    elements.progress.textContent = `${orderedPaintings.length} / ${orderedPaintings.length}`;
    elements.image.removeAttribute("src");
    elements.number.textContent = "Complete";
    elements.name.textContent = "All paintings shown";
    elements.meta.textContent = "";
    elements.description.textContent = "";
    elements.topBidders.innerHTML = "";
    elements.winnerPanel.hidden = true;
    elements.optOut.hidden = true;
    elements.primary.textContent = "Finished";
    elements.primary.disabled = true;
    elements.message.textContent = "The allocation table is up to date.";
    elements.message.className = "validation-message ok";
    return;
  }

  const winner = currentWinner();
  elements.progress.textContent = `${state.currentIndex + 1} / ${orderedPaintings.length}`;
  elements.image.src = painting.image || imagePath(painting.id);
  elements.image.alt = painting.name;
  elements.number.textContent = `Painting #${painting.id} | ${formatCredits(popularity[painting.id].total)} initial credits`;
  elements.name.textContent = painting.name;
  elements.meta.textContent = `${painting.dimensions}${painting.year ? ` | ${painting.year}` : ""}`;
  elements.description.textContent = painting.description || "";
  renderTopBidders(painting.id);

  if (winnerVisible) {
    elements.winnerPanel.hidden = false;
    elements.winnerName.textContent = winner || "No eligible winner";
    elements.optOut.hidden = !winner;
    elements.primary.textContent = "Next Painting";
    elements.primary.disabled = false;
    elements.message.textContent = winner ? "" : "No active participant has credits on this painting.";
    elements.message.className = winner ? "validation-message" : "validation-message error";
  } else {
    elements.winnerPanel.hidden = true;
    elements.winnerName.textContent = "";
    elements.optOut.hidden = true;
    elements.primary.textContent = "Reveal Winner";
    elements.primary.disabled = false;
    elements.message.textContent = "";
    elements.message.className = "validation-message";
  }
}

function renderTopBidders(paintingId) {
  const bidders = popularity[paintingId].topBidders;
  elements.topBidders.innerHTML = "";
  if (bidders.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No initial credits";
    elements.topBidders.append(item);
    return;
  }
  for (const bidder of bidders) {
    const item = document.createElement("li");
    item.innerHTML = `${bidder.name} <span>${formatCredits(bidder.credits)} credits</span>`;
    elements.topBidders.append(item);
  }
}

async function primaryAction() {
  if (!winnerVisible) {
    winnerVisible = true;
    renderCurrent();
    return;
  }

  const painting = currentPainting();
  if (!painting) {
    return;
  }

  state.accepted[painting.id] = currentWinner() || null;
  state.currentIndex += 1;
  persistState();
  await recomputeAndRender(false);
}

async function optOutCurrentWinner() {
  const winner = currentWinner();
  if (!winner) {
    return;
  }

  const key = canonicalName(winner);
  if (!state.optOuts.some((name) => canonicalName(name) === key)) {
    state.optOuts.push(winner);
  }
  persistState();
  await recomputeAndRender(true);
  const replacement = currentWinner();
  elements.message.textContent = replacement
    ? `${winner} opted out. New winner shown.`
    : `${winner} opted out. No eligible winner remains for this painting.`;
  elements.message.className = replacement ? "validation-message ok" : "validation-message error";
}

function renderSummary() {
  if (!allocation) {
    return;
  }
  const rows = [...auction.paintings].sort((left, right) => comparePaintingIds(left.id, right.id));
  elements.summaryRows.innerHTML = "";
  for (const painting of rows) {
    const winner = state.accepted[painting.id] ?? allocation.winnerByPainting[painting.id] ?? "";
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${painting.id}</td>
      <td>${painting.name}</td>
      <td>${winner || "Unassigned"}</td>
    `;
    elements.summaryRows.append(row);
  }
}

function persistState() {
  writeJSON(CONFIG.storage.results, state);
}
