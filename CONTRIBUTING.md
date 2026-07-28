# Contributing

## The one rule

**The hub must not know a single integration by name.** It knows providers,
layers, nodes, edges, actions and capabilities — nothing else. A pull
request that adds a special case for one integration will be declined, no
matter how small, because the second one is always easier than the first.

If something cannot be expressed through the public contract, that is a bug
in the contract. Say so, and we fix the contract — for everybody at once.

Three tests hold the line, and they are worth reading before you start:

- `tests/test_frontend.py::test_the_renderer_knows_no_integration_by_name`
- `tests/test_generic.py::test_the_generic_adapter_gets_no_shortcut_into_the_hub`
  — the hub's *own* built-in layers register through the same public dict a
  stranger uses, with the same validation.
- `tests/test_community.py::test_the_directory_stays_documentation`

## You do not need to ask us

If you maintain an integration and want it on the floor plan, **nothing
here has to change**. Copy two files into your own repository and call one
function: [`sdk/README.md`](sdk/README.md). There is no registration, no
allowlist, no approval, and no release of ours to wait for.

When it works, a one-line PR to [`docs/PROVIDERS.md`](docs/PROVIDERS.md)
puts you on the list so users can find you. That list is documentation and
has no effect on code.

## Language

User-facing docs (`README.md`, `ROADMAP.md`, `docs/ASK_FOR_SUPPORT.de.md`) are
German. Maintainer-facing material (`sdk/`, this file, code comments, commit
messages, test names) is English, because the people it is aimed at maintain
integrations in every language there is. `docs/PROVIDER_API.md` is German
with an English SDK page alongside it; if you want to translate either
direction, that is a welcome PR.

## Running the tests

```bash
python -m pytest -q          # the hub
node --test tests/test_panel_logic.mjs   # the renderer's own logic
```

Before changing the renderer, also render it: [`tools/README.md`](tools/README.md)
sets up a throwaway Home Assistant and drives the panel in a real browser.
The first genuine bug this project had -- rooms drawn on top of each other --
was invisible to every test above and obvious in the first screenshot.

The renderer has no build step and no bundler — it is one ES module, and it
is meant to stay readable by someone who did not write it.

## Writing a test

Name it after the behaviour, not the function: `test_hidden_things_are_
reported_so_they_can_come_back`, not `test_apply_layout_2`. When a test
fails at three in the morning, its name is the entire error message.

Assertions carry a message saying *why it hurts*, not what the values were —
pytest already prints the values.

## Commits

One commit per idea, present tense, and the message explains the decision
rather than the diff. "A vendoring SDK, not a package" beats "add sdk/".
