# Papi Art Distribution

A simple website to run an auction for distributing items (art works, in this case) fairly, based on pre-set allocations of virtual "credits" representing each person's subjective preferences.

## Pages

- `index.html`: family-facing introduction that explains the process and links to the entry page.
- `allocations.html`: participant page for entering a name, assigning credits, and copying the submission token.
- `master.html`: auction-master page for pasting participant tokens, editing entries, choosing the deterministic tie-break seed, and launching results.
- `results.html`: live reveal page that shows paintings in order of initial popularity and reveals winners one at a time.

The site is fully static and intended to work on GitHub Pages. Participant submissions are copied as `PAPI_ART_BID_V1` tokens and pasted into the auction-master page; auction state is stored in the browser's `localStorage`.

## Local Preview

From the project root:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/`.
