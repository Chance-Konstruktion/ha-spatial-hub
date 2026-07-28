# "Any chance of Spatial Hub support?"

You use an integration that is missing from your floor plan. This page is
the text you file in its repository — and a few requests about how.

The German version, with the same text, is
[ASK_FOR_SUPPORT.de.md](ASK_FOR_SUPPORT.de.md).

## First: do you need to ask at all?

Probably not. In the hub, edit mode → **+ Layer**, you describe what belongs
on the plan yourself: all the lights, everything in one area, everything
carrying a label. That needs nobody but you.

A real adapter is still better — it knows what the data *means*, can draw
the connections between devices, name states properly and offer actions.
But you are not blocked while you wait, and that belongs in the request.

## Ask once, kindly, and then stop

A maintainer who gets ten identical issues from ten people does not ship the
feature faster. They close the repo.

- **Search first.** If the issue exists, give it a 👍 and write nothing. A
  "+1" is a notification with no content in it.
- **One repo, one issue.** Not twenty at once, not as a campaign.
- **Do not ask for a date.** Nobody owes you a timeline.
- **"No" is an answer.** It costs you nothing — see above.
- **Offer to do it yourself.** That is the difference between a demand and
  an offer. It is about twenty lines, and you are allowed to write them.

## The text

Copy everything below. Replace the square brackets.

---

**Title:** Support for Spatial Hub (optional, ~20 lines, no dependency)

Hi — thanks for this integration, I use it daily.

There is a fairly new project called
[Spatial Hub](https://github.com/Chance-Konstruktion/ha-spatial-hub): a
service that collects spatial data from arbitrary integrations and merges it
into *one* floor plan, instead of every integration shipping its own
dashboard. Floors and areas come from Home Assistant, the user arranges
things once, and that arrangement belongs to the hub afterwards.

I am not asking for a timeline and would not be disappointed by a no. But
the effort looks small enough to be worth mentioning:

```python
from .spatial_hub_provider import spatial_provider

spatial_provider(
    hass,
    entry,
    name="[integration name]",
    icon="mdi:[icon]",
    data=lambda: [ ... entity_ids or node() dicts ... ],
    coordinator=coordinator,
)
```

That is the whole thing. Registering, withdrawing on unload, and notifying
the hub after every coordinator refresh are all inside that one call.

What it does **not** cost:

- **No dependency.** One file is copied into the repository, `manifest.json`
  is untouched. There is nothing to pin and nothing to resolve.
- **No different behaviour without the hub.** The file writes a dict into
  `hass.data` and fires a dispatcher signal. If the hub is not installed
  nobody listens — the integration behaves exactly as before. Load order
  does not matter.
- **No frontend.** No card, no YAML, no CSS.
- **No layout to store.** You deliberately do not send positions; the hub
  places, the user corrects, and that stays with the hub.

For checking it there is a conformance kit — one file in the test suite,
needs pytest only, no Home Assistant and no installed hub.

Setup that does the copying for you:

```bash
python3 sdk/install.py --into custom_components/[domain] --tests tests
```

Everything about it: [sdk/README.md](https://github.com/Chance-Konstruktion/ha-spatial-hub/blob/main/sdk/README.md).
A complete example integration lives in
[examples/](https://github.com/Chance-Konstruktion/ha-spatial-hub/tree/main/examples/example_provider) —
not snippets, but a whole file that runs inside their own test suite.

If you like, I will open the PR. Just say the word.

---

## If you write the PR yourself

All the better. Keep it short, and make the review easy:

- Everything in **one** commit, clearly named.
- Submit the conformance test **with** it — then the maintainer does not
  have to work out whether it is correct.
- Repeat the three sentences about "no dependency, no behaviour change
  without the hub, no frontend" in the PR description. That is the first
  question a reviewer has.
- Do not take it personally if they want it done differently. It is their
  repo.
