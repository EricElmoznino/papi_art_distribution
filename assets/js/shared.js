export const CONFIG = Object.freeze({
  totalCredits: 100,
  maxPerPainting: 50,
  minPaintings: 6,
  submissionPrefix: "PAPI_ART_BID_V1:",
  storage: {
    submissions: "papiArt.submissions.v1",
    auction: "papiArt.auction.v1",
    results: "papiArt.results.v1",
    draft: "papiArt.participantDraft.v1",
    seed: "papiArt.seed.v1",
  },
});

const EPSILON = 1e-9;

export async function loadPaintings() {
  const response = await fetch("assets/data.csv", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load assets/data.csv (${response.status})`);
  }

  const rows = parseCSV(await response.text());
  return rows.map((row, index) => ({
    id: String(row.id ?? "").trim(),
    name: String(row.name ?? "").trim(),
    dimensions: String(row.dimensions ?? "").trim(),
    year: String(row.year ?? "").trim(),
    description: String(row.description ?? "").trim(),
    image: imagePath(String(row.id ?? "").trim()),
    order: index,
  })).filter((painting) => painting.id);
}

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).filter((values) => values.some((value) => value.trim() !== "")).map((values) => {
    const entry = {};
    headers.forEach((header, index) => {
      entry[header] = values[index] ?? "";
    });
    return entry;
  });
}

export function imagePath(id) {
  return `assets/images/${encodeURIComponent(id)}.jpg`;
}

export function cleanName(name) {
  return String(name ?? "").trim().replace(/\s+/g, " ");
}

export function canonicalName(name) {
  return cleanName(name).toLocaleLowerCase();
}

export function normalizeBids(paintings, bids) {
  const normalized = {};
  for (const painting of paintings) {
    const raw = bids?.[painting.id] ?? 0;
    const value = Number(raw);
    normalized[painting.id] = Number.isFinite(value) ? value : 0;
  }
  return normalized;
}

export function bidSummary(paintings, bids) {
  const normalized = normalizeBids(paintings, bids);
  const values = paintings.map((painting) => normalized[painting.id]);
  const total = values.reduce((sum, value) => sum + value, 0);
  const distinct = values.filter((value) => value > EPSILON).length;
  const overMax = paintings.filter((painting) => normalized[painting.id] > CONFIG.maxPerPainting + EPSILON);
  const negative = paintings.filter((painting) => normalized[painting.id] < -EPSILON);
  const fractional = paintings.filter((painting) => Math.abs(normalized[painting.id] - Math.round(normalized[painting.id])) > EPSILON);
  return { normalized, total, distinct, overMax, negative, fractional };
}

export function validateSubmission(name, paintings, bids) {
  const errors = [];
  const summary = bidSummary(paintings, bids);
  const minimumPaintings = Math.min(CONFIG.minPaintings, paintings.length);

  if (!cleanName(name)) {
    errors.push("Enter a name.");
  }
  if (Math.abs(summary.total - CONFIG.totalCredits) > EPSILON) {
    errors.push(`Allocate exactly ${CONFIG.totalCredits} credits.`);
  }
  if (summary.distinct < minimumPaintings) {
    errors.push(`Use at least ${minimumPaintings} different paintings.`);
  }
  if (summary.overMax.length > 0) {
    errors.push(`No painting can receive more than ${CONFIG.maxPerPainting} credits.`);
  }
  if (summary.negative.length > 0) {
    errors.push("Credits cannot be negative.");
  }
  if (summary.fractional.length > 0) {
    errors.push("Credits must be whole numbers.");
  }

  return {
    valid: errors.length === 0,
    errors,
    summary,
  };
}

export async function makeSubmissionToken(name, paintings, bids) {
  const normalized = normalizeBids(paintings, bids);
  const payload = {
    type: "papi-art-bid",
    version: 1,
    name: cleanName(name),
    totalCredits: CONFIG.totalCredits,
    maxPerPainting: CONFIG.maxPerPainting,
    minPaintings: CONFIG.minPaintings,
    paintingIds: paintings.map((painting) => painting.id),
    paintingsFingerprint: await paintingsFingerprint(paintings),
    bids: normalized,
    createdAt: new Date().toISOString(),
  };
  return `${CONFIG.submissionPrefix}${base64UrlEncode(JSON.stringify(payload))}`;
}

export async function parseSubmissionsFromText(text, paintings) {
  const submissions = [];
  const errors = [];
  const warnings = [];
  const currentFingerprint = await paintingsFingerprint(paintings);
  const tokenPattern = new RegExp(`${CONFIG.submissionPrefix}([A-Za-z0-9_-]+)`, "g");
  const tokens = [...String(text).matchAll(tokenPattern)].map((match) => match[1]);

  if (tokens.length === 0) {
    errors.push("No PAPI_ART_BID_V1 submission token was found.");
    return { submissions, errors, warnings };
  }

  tokens.forEach((token, index) => {
    try {
      const payload = JSON.parse(base64UrlDecode(token));
      if (payload.type !== "papi-art-bid" || payload.version !== 1) {
        throw new Error("Unsupported submission format.");
      }

      const name = cleanName(payload.name);
      const bids = normalizeBids(paintings, payload.bids ?? {});
      const validation = validateSubmission(name, paintings, bids);
      if (!validation.valid) {
        errors.push(`${name || `Submission ${index + 1}`}: ${validation.errors.join(" ")}`);
        return;
      }
      if (payload.paintingsFingerprint && payload.paintingsFingerprint !== currentFingerprint) {
        warnings.push(`${name}: the painting list fingerprint differs from this page.`);
      }
      submissions.push({
        name,
        bids,
        createdAt: payload.createdAt || null,
      });
    } catch (error) {
      errors.push(`Submission ${index + 1} could not be parsed: ${error.message}`);
    }
  });

  return { submissions, errors, warnings };
}

export function base64UrlEncode(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlDecode(text) {
  const padded = String(text).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export async function paintingsFingerprint(paintings) {
  const source = paintings.map((painting) => `${painting.id}|${painting.name}`).join("\n");
  return sha256Hex(source);
}

export async function sha256Hex(text) {
  if (globalThis.crypto?.subtle && globalThis.TextEncoder) {
    const bytes = new TextEncoder().encode(text);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return fallbackHashHex(text);
}

function fallbackHashHex(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const part = `${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
  return part.repeat(4).slice(0, 64);
}

export async function allocatePaintings({ paintings, submissions, seed, excludedAgents = [], lockedAllocations = [] }) {
  const paintingIds = paintings.map((painting) => painting.id);
  const agents = submissions.map((submission) => submission.name);
  const excluded = new Set(excludedAgents.map(canonicalName));
  const activeAgents = new Set(agents.filter((agent) => !excluded.has(canonicalName(agent))));
  const originalBids = {};
  const currentBids = {};
  const allocations = {};
  const winCounts = {};
  const events = [];
  const tieScores = await buildTieScores(seed, agents, paintingIds);

  for (const submission of submissions) {
    originalBids[submission.name] = normalizeBids(paintings, submission.bids);
    currentBids[submission.name] = { ...originalBids[submission.name] };
    allocations[submission.name] = [];
    winCounts[submission.name] = 0;
  }

  const available = new Set(paintingIds);

  function rollover(agent, lostBid) {
    if (lostBid <= EPSILON) {
      return;
    }
    const desired = [...available].filter((paintingId) => originalBids[agent][paintingId] > EPSILON);
    const originalTotal = desired.reduce((sum, paintingId) => sum + originalBids[agent][paintingId], 0);
    if (originalTotal <= EPSILON) {
      return;
    }
    for (const paintingId of desired) {
      currentBids[agent][paintingId] += lostBid * (originalBids[agent][paintingId] / originalTotal);
    }
  }

  function removePainting(paintingId, winnerName, locked = false) {
    if (!available.has(paintingId)) {
      return;
    }

    available.delete(paintingId);
    if (winnerName && allocations[winnerName]) {
      allocations[winnerName].push(paintingId);
      winCounts[winnerName] += 1;
      currentBids[winnerName][paintingId] = 0;
    }

    for (const agent of agents) {
      if (!activeAgents.has(agent) || agent === winnerName) {
        if (currentBids[agent]) {
          currentBids[agent][paintingId] = 0;
        }
        continue;
      }
      const lostBid = currentBids[agent][paintingId] ?? 0;
      currentBids[agent][paintingId] = 0;
      rollover(agent, lostBid);
    }

    if (locked) {
      events.push({
        sequence: events.length + 1,
        phase: 0,
        paintingId,
        winnerName: winnerName || null,
        bid: null,
        locked: true,
      });
    }
  }

  for (const lock of lockedAllocations) {
    removePainting(String(lock.paintingId), lock.winnerName || null, true);
  }

  let phaseLimit = 1;
  let guard = 0;
  const guardLimit = Math.max(1000, paintingIds.length * Math.max(1, agents.length) * 20);

  while (available.size > 0 && guard < guardLimit) {
    guard += 1;
    const activeList = agents.filter((agent) => activeAgents.has(agent));
    const globalBidsRemain = activeList.some((agent) => sumCurrentBids(currentBids[agent], available) > EPSILON);
    if (!globalBidsRemain) {
      break;
    }

    const eligibleAgents = activeList.filter((agent) => (
      winCounts[agent] < phaseLimit && sumCurrentBids(currentBids[agent], available) > EPSILON
    ));
    if (eligibleAgents.length === 0) {
      phaseLimit += 1;
      continue;
    }

    let bestAgent = null;
    let bestPainting = null;
    let maxBid = -Infinity;
    let maxTieScore = "";

    for (const agent of eligibleAgents) {
      for (const paintingId of available) {
        const bid = currentBids[agent][paintingId] ?? 0;
        if (bid <= EPSILON) {
          continue;
        }
        const tieScore = tieScores[agent][paintingId];
        if (bid > maxBid + EPSILON || (Math.abs(bid - maxBid) <= EPSILON && tieScore > maxTieScore)) {
          bestAgent = agent;
          bestPainting = paintingId;
          maxBid = bid;
          maxTieScore = tieScore;
        }
      }
    }

    if (!bestAgent || !bestPainting) {
      break;
    }

    removePainting(bestPainting, bestAgent, false);
    events.push({
      sequence: events.length + 1,
      phase: phaseLimit,
      paintingId: bestPainting,
      winnerName: bestAgent,
      bid: maxBid,
      tieScore: maxTieScore,
      locked: false,
    });
  }

  const winnerByPainting = {};
  for (const [agent, paintingList] of Object.entries(allocations)) {
    for (const paintingId of paintingList) {
      winnerByPainting[paintingId] = agent;
    }
  }

  const unassigned = paintingIds.filter((paintingId) => !winnerByPainting[paintingId]);

  return {
    allocations,
    events,
    winnerByPainting,
    unassigned,
    winCounts,
  };
}

async function buildTieScores(seed, agents, paintingIds) {
  const scores = {};
  await Promise.all(agents.map(async (agent) => {
    scores[agent] = {};
    await Promise.all(paintingIds.map(async (paintingId) => {
      scores[agent][paintingId] = await sha256Hex(`${seed}_${agent}_${paintingId}`);
    }));
  }));
  return scores;
}

function sumCurrentBids(bids, available) {
  let total = 0;
  for (const paintingId of available) {
    total += bids[paintingId] ?? 0;
  }
  return total;
}

export function popularityByPainting(paintings, submissions) {
  const popularity = {};
  for (const painting of paintings) {
    const bidders = submissions.map((submission) => ({
      name: submission.name,
      credits: Number(submission.bids?.[painting.id] ?? 0),
    })).filter((entry) => entry.credits > EPSILON)
      .sort((left, right) => {
        if (right.credits !== left.credits) {
          return right.credits - left.credits;
        }
        return left.name.localeCompare(right.name);
      });

    popularity[painting.id] = {
      total: bidders.reduce((sum, entry) => sum + entry.credits, 0),
      topBidders: bidders.slice(0, 4),
    };
  }
  return popularity;
}

export function revealOrder(paintings, submissions) {
  const popularity = popularityByPainting(paintings, submissions);
  return [...paintings].sort((left, right) => {
    const difference = popularity[right.id].total - popularity[left.id].total;
    if (Math.abs(difference) > EPSILON) {
      return difference;
    }
    return comparePaintingIds(left.id, right.id);
  });
}

export function comparePaintingIds(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}

export function formatCredits(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "0";
  }
  if (Math.abs(number - Math.round(number)) < 0.001) {
    return String(Math.round(number));
  }
  return number.toFixed(2);
}

export function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
