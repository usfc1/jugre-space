# JUGRE SI service

This Cloudflare Worker receives mission descriptions from the desktop app and
requests a structured proposal from `gpt-6.1-terra` with medium reasoning. The
game validates proposals using its existing mission and vehicle engines.

The Worker accepts anonymous requests so all players can use SI without a
sign-in. The OpenAI API key is stored only as a Cloudflare Worker secret; it is
never included in source code, the game, the EXE, or a normal `vars` entry.
Credentials and user prompts are not logged by this Worker.

For the local web version, run `desktop/start-web.cmd`. The endpoint allows
cross-origin browser requests and can also be called outside the game. Usage is
charged to the owner's OpenAI project. The Cloudflare rate limit is per client
IP and per location; it is not a global spending cap. Configure an OpenAI
project spending limit too.

For maintenance, set or rotate the Worker secret interactively with
`wrangler secret put OPENAI_API_KEY`, then deploy changes with `wrangler deploy`.
`desktop/si-service.json` contains only the non-secret HTTPS service address.
Run `npm test` in this directory for the access and request tests.
