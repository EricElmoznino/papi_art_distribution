# AGENTS.md

Project-specific context for future agents working in this repository.

## Project Purpose

This is a small static website for distributing a family art collection in a way that reflects emotional preference without treating the paintings as financial assets.

Participants receive imaginary credits and privately allocate those credits across paintings they would be happy to receive. The auction master collects those one-time submissions, chooses a deterministic tie-break seed, runs the allocation, and reveals winners one painting at a time.

The family-facing explanation should stay simple:

- Everyone starts with the same number of credits.
- Credits represent preference intensity, not money.
- Nobody should receive a painting they gave zero credits to.
- Lost bids are not wasted; when someone loses a painting, those credits roll over to that person's remaining desired paintings in proportion to the original bid pattern.
- The algorithm tries to give everyone who wants a painting one painting before anyone receives a second, then repeats for second paintings, third paintings, etc.
- Ties are resolved automatically from a shared seed so the same inputs always produce the same result.

## Technology and Deployment

This project is intentionally minimal:

- Static HTML, CSS, and JavaScript modules only.
- No build step.
- No package manager or third-party runtime libraries.
- Intended for GitHub Pages.
- Browser `localStorage` is used for draft entries, collected submissions, auction state, reveal progress, and the tie-break seed.
- The participant flow uses copy/paste submission tokens because GitHub Pages does not provide a backend endpoint for collecting submissions.

For local preview, serve the directory over HTTP from the project root:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/`. Serving over HTTP is preferable because the app fetches `assets/data.csv` and uses ES modules.

## Repository Map

- `index.html`: family-facing home page explaining the process before entry.
- `allocations.html`: participant page.
- `master.html`: auction-master page.
- `results.html`: live results/reveal page.
- `assets/css/styles.css`: all styling and responsive layout.
- `assets/data.csv`: painting metadata.
- `assets/images/{id}.jpg`: painting images, where `{id}` matches the CSV `id`.
- `assets/js/shared.js`: shared config, CSV loading, validation, token parsing, deterministic hashing, allocation algorithm, popularity/reveal helpers, and localStorage helpers.
- `assets/js/user.js`: participant-page behavior.
- `assets/js/master.js`: auction-master behavior.
- `assets/js/results.js`: result reveal, opt-outs, locked allocations, and summary table behavior.
- `README.md`: short public-facing project overview.

There is currently no automated test suite.

## Data Model

`assets/data.csv` is the source of truth for the painting list. It has these columns:

```csv
id,name,dimensions,year,description
```

`loadPaintings()` in `assets/js/shared.js` converts each row into:

```js
{
  id,
  name,
  dimensions,
  year,
  description,
  image: `assets/images/${encodeURIComponent(id)}.jpg`,
  order: index
}
```

Keep image filenames aligned with CSV ids. The current data set has 33 paintings and matching JPG files.

## Current Business Rules

The current JavaScript behavior is the ground truth.

`CONFIG` in `assets/js/shared.js` currently defines:

```js
totalCredits: 100
maxPerPainting: 50
requiredPaintings: 6
minPaintings: 6
```

Important validation behavior:

- A participant must enter a non-empty name.
- Bids must total exactly 100 credits.
- Credits must be whole numbers.
- Credits cannot be negative.
- No painting may receive more than 50 credits.
- A valid submission must allocate credits across at least 6 paintings.

`validateSubmission()` uses `CONFIG.minPaintings` as the minimum selected-painting threshold. `requiredPaintings` is still present in config and submission payloads for compatibility with the existing token shape.

## Home Page

`index.html` is the first page family members should see. It gives an intuitive explanation of the process, emphasizes that credits represent subjective preference rather than money, and links to `allocations.html`.

Keep this explanation simple. Do not add a mechanistic explanation of the allocation algorithm to the home page.

## Participant Page

`allocations.html` plus `assets/js/user.js` implements the participant flow:

- Loads paintings from `assets/data.csv`.
- Restores the participant's in-progress draft from `localStorage` key `papiArt.participantDraft.v1`.
- Lets the participant enter a name and credits per painting.
- Shows remaining credits, allocated credits, and selected painting count.
- Validates continuously using `validateSubmission()`.
- Enables `Copy Data` only when the entry is valid.
- Creates a `PAPI_ART_BID_V1:` submission token with `makeSubmissionToken()`.
- Copies the token to the clipboard when available, and also displays it in a readonly textarea as a fallback.
- Includes an image modal with zoom controls.

The participant does not send anything to a server.

## Submission Token Format

Submission tokens have this format:

```text
PAPI_ART_BID_V1:<base64url-json>
```

The decoded JSON payload includes:

```js
{
  type: "papi-art-bid",
  version: 1,
  name,
  totalCredits,
  maxPerPainting,
  requiredPaintings,
  minPaintings,
  paintingIds,
  paintingsFingerprint,
  bids,
  createdAt
}
```

`parseSubmissionsFromText()` can extract one or more tokens from arbitrary pasted text. It validates each parsed token against the current `assets/data.csv` painting list and current validation rules.

If a token's `paintingsFingerprint` differs from the current page's fingerprint, the parser emits a warning but can still accept the submission if the normalized bids validate.

## Auction-Master Page

`master.html` plus `assets/js/master.js` implements collection and setup:

- Parses pasted participant tokens.
- Allows manual entry and editing of submissions.
- Replaces earlier entries when a new entry has the same canonicalized participant name.
- Sorts submissions alphabetically by participant name after upsert.
- Validates all submissions before running the auction.
- Stores collected submissions in `localStorage` key `papiArt.submissions.v1`.
- Stores the tie-break seed in `localStorage` key `papiArt.seed.v1`.
- On `Run Auction`, writes the auction object to `localStorage` key `papiArt.auction.v1`, clears old results state, and navigates to `results.html`.
- `Download Backup` downloads a JSON file containing `savedAt`, `seed`, and `submissions`. There is currently no corresponding backup-import UI.

The auction object stored by `runAuction()` contains:

```js
{
  id: `auction-${Date.now()}`,
  createdAt,
  seed,
  paintings,
  submissions,
  config
}
```

## Results Page

`results.html` plus `assets/js/results.js` implements the reveal:

- Reads the auction object from `localStorage`.
- Stores reveal state in `localStorage` key `papiArt.results.v1`.
- Reveals paintings in `revealOrder()`, which sorts by total initial credits descending, then by painting id.
- Uses `popularityByPainting()` to display top initial bidders. The UI shows names only, not bid amounts.
- Calls `allocatePaintings()` to compute the full allocation immediately, but only reveals one current painting at a time.
- After a winner is accepted and the auction master clicks `Next Painting`, that painting/winner pair becomes a locked allocation for future recomputations.
- If the current winner opts out, that participant is added to `state.optOuts` and the allocation is recomputed with that agent excluded globally from future active bidding.
- Previously accepted allocations remain locked even if that participant later opts out of another painting.
- The summary table shows accepted winners where available, otherwise the current recomputed winner, otherwise `Unassigned`.

## localStorage Keys

Configured in `CONFIG.storage`:

- `papiArt.submissions.v1`: collected auction-master submissions.
- `papiArt.auction.v1`: current auction object.
- `papiArt.results.v1`: reveal progress, accepted locks, and opt-outs for the current auction id.
- `papiArt.participantDraft.v1`: participant page draft.
- `papiArt.seed.v1`: remembered deterministic tie-break seed.

Changing storage keys is a migration-sensitive change because existing browser state will no longer be found.

## Allocation Algorithm: JavaScript Ground Truth

The core algorithm is `allocatePaintings()` in `assets/js/shared.js`.

Inputs:

```js
{
  paintings,
  submissions,
  seed,
  excludedAgents = [],
  lockedAllocations = []
}
```

Outputs:

```js
{
  allocations,
  events,
  winnerByPainting,
  unassigned,
  winCounts
}
```

Important implementation details:

- Agent names come from `submissions.map((submission) => submission.name)`.
- Active agents are all agents except canonicalized `excludedAgents`.
- `originalBids[agent]` is a normalized copy of the submitted bids.
- `currentBids[agent]` starts as a copy of `originalBids[agent]`.
- Tie scores are precomputed for every agent/painting pair using `sha256Hex(`${seed}_${agent}_${paintingId}`)`.
- A larger SHA-256 hex string wins a bid tie.
- `available` is a `Set` initialized in painting CSV order.
- `phaseLimit` starts at 1.
- An active agent is eligible in a phase when `winCounts[agent] < phaseLimit` and they have non-zero current bids on available paintings.
- If no eligible agents remain in the current phase but active bids remain globally, `phaseLimit` increments.
- The winner's bid on the won painting is consumed and does not roll over.
- Every other active agent's non-zero current bid on the removed painting rolls over proportionally to that agent's remaining originally desired available paintings.
- Excluded/inactive agents do not roll over credits.
- Locked allocations are processed before the main loop. They remove paintings, assign the locked winner if present, increment that winner's win count, clear bids on the locked painting, and roll over lost bids for active non-winners.
- The function terminates when no paintings remain, no active bids remain, or a guard limit is reached.

### Allocation Pseudocode

This pseudocode mirrors the current JavaScript, including locked allocations and external opt-outs.

```text
function AllocatePaintings(Paintings, Submissions, Seed, ExcludedAgents, LockedAllocations):
    PaintingIds = Paintings.map(id)
    Agents = Submissions.map(name)
    ActiveAgents = Agents excluding canonicalized ExcludedAgents

    OriginalBids = normalized submitted bids for every agent
    CurrentBids = copy of OriginalBids
    Allocations = {agent: [] for agent in Agents}
    WinCounts = {agent: 0 for agent in Agents}
    Events = []
    TieScores = SHA256_HEX(Seed + "_" + agent + "_" + paintingId) for every pair
    Available = Set(PaintingIds in painting order)

    function Rollover(agent, lostBid):
        if lostBid <= EPSILON:
            return

        Desired = available paintings where OriginalBids[agent][paintingId] > EPSILON
        OriginalTotal = sum OriginalBids[agent][paintingId] for Desired
        if OriginalTotal <= EPSILON:
            return

        for paintingId in Desired:
            proportion = OriginalBids[agent][paintingId] / OriginalTotal
            CurrentBids[agent][paintingId] += lostBid * proportion

    function RemovePainting(paintingId, winnerName, locked):
        if paintingId is not available:
            return

        remove paintingId from Available

        if winnerName is present:
            Allocations[winnerName].append(paintingId)
            WinCounts[winnerName] += 1
            CurrentBids[winnerName][paintingId] = 0

        for agent in Agents:
            if agent is inactive or agent == winnerName:
                CurrentBids[agent][paintingId] = 0
                continue

            lostBid = CurrentBids[agent][paintingId]
            CurrentBids[agent][paintingId] = 0
            Rollover(agent, lostBid)

        if locked:
            record a phase-0 locked event

    for lock in LockedAllocations:
        RemovePainting(lock.paintingId, lock.winnerName or null, locked = true)

    PhaseLimit = 1
    Guard = 0
    GuardLimit = max(1000, PaintingIds.length * max(1, Agents.length) * 20)

    while Available is not empty and Guard < GuardLimit:
        Guard += 1

        ActiveList = Agents still in ActiveAgents
        if no ActiveList agent has any current bid on Available:
            break

        EligibleAgents = active agents with:
            WinCounts[agent] < PhaseLimit
            and sum current bids on Available > EPSILON

        if EligibleAgents is empty:
            PhaseLimit += 1
            continue

        BestAgent = null
        BestPainting = null
        MaxBid = -Infinity
        MaxTieScore = ""

        for agent in EligibleAgents:
            for paintingId in Available:
                bid = CurrentBids[agent][paintingId]
                if bid <= EPSILON:
                    continue

                tieScore = TieScores[agent][paintingId]
                if bid > MaxBid + EPSILON:
                    BestAgent = agent
                    BestPainting = paintingId
                    MaxBid = bid
                    MaxTieScore = tieScore
                else if abs(bid - MaxBid) <= EPSILON and tieScore > MaxTieScore:
                    BestAgent = agent
                    BestPainting = paintingId
                    MaxBid = bid
                    MaxTieScore = tieScore

        if no BestAgent or no BestPainting:
            break

        RemovePainting(BestPainting, BestAgent, locked = false)
        record an event with sequence, phase, paintingId, winnerName, bid, tieScore

    WinnerByPainting = invert Allocations
    Unassigned = painting ids with no winner

    return Allocations, Events, WinnerByPainting, Unassigned, WinCounts
```

### Opt-Out Behavior

Opt-out is not an interactive callback inside `allocatePaintings()`. It is implemented by the results page:

1. The current allocation is computed.
2. The current painting's winner is revealed.
3. If that winner opts out, `results.js` adds the winner name to `state.optOuts`.
4. `results.js` recomputes `allocatePaintings()` with `excludedAgents: state.optOuts`.
5. The same current painting remains on screen and the replacement winner, if any, is shown.

This means opt-out removes the person from active bidding for the rest of the reveal. Prior accepted paintings are preserved through `lockedAllocations`.

## Determinism Notes

The allocation is intended to be reproducible for the same:

- Painting list and order.
- Submission list and order.
- Bid values.
- Seed.
- Accepted locks.
- Opt-out list.

Tie-breaking uses deterministic hashing. The primary implementation uses `crypto.subtle.digest("SHA-256")`; `fallbackHashHex()` is available when Web Crypto is unavailable. Be careful changing this because a different hash implementation can change winners in tied cases.

If future changes introduce sorting, randomization, or iteration over plain objects, keep deterministic ordering explicit.

## UI and Styling Notes

The app is responsive through CSS media queries in `assets/css/styles.css`:

- Participant cards use a two-column grid on wider screens and collapse to one column below 920px.
- Master panels also collapse below 920px.
- Results use a large image/copy split layout on desktop and a single column on smaller screens.
- The participant summary is sticky and uses a CSS variable `--participant-topbar-height` updated by `user.js` so it sits below the sticky topbar.

Keep the interface simple and family-friendly. Avoid turning the credits into money language such as bids, price, auction price, payment, or value in visible copy when possible. The code uses "bid" internally because it is concise, but user-facing text should emphasize preferences and credits.

## Known Gaps and Cautions

- There are no automated tests. For algorithm changes, add focused tests or create a deterministic local harness before changing behavior.
- The result reveal recomputes the whole allocation after each accepted painting or opt-out. This is intentional because accepted locks and opt-outs affect later winners.
- `events` from `allocatePaintings()` are currently not displayed in the UI, but they are useful for debugging allocation order.
- `Download Backup` has no import counterpart.
- The app trusts browser `localStorage`; clearing browser data loses collected submissions unless a backup was downloaded.
- Submission tokens include a timestamp, so two otherwise identical copied tokens will differ.
- The minimum-six validation rule affects participant validation, token parsing, manual entry, and family expectations. Do not silently change it.

## Change Guidelines

- Preserve the no-build, static GitHub Pages architecture unless explicitly asked to change it.
- Do not add dependencies without a strong reason and user approval.
- Treat `assets/js/shared.js` as the source of truth for rules shared across pages.
- Keep participant and master validation identical by using shared helpers.
- When changing token payloads, maintain backward parsing or update the version/prefix deliberately.
- When changing allocation behavior, update this file and any family-facing explanation together.
- When editing CSS, check both desktop and phone-sized layouts.
- Do not modify code in unrelated files while making documentation-only changes.
