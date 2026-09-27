# Display boundary browser test

Run `npm run test:display-browser` after installing the project's development
dependencies and Chromium (`npx playwright install chromium`). This standalone
test needs no Foundry server and deliberately provides no global DOMPurify.
It serves repository modules only on loopback and exercises the real sanitizer
and sidebar insertion methods with minimal Foundry API fixtures.

For an externally managed Playwright installation or browser, set
`SIMULACRUM_PLAYWRIGHT_MODULE` to its importable module path and/or
`SIMULACRUM_CHROMIUM_PATH` to its Chromium executable. Failure to launch is a test
failure, not a skip. This is local browser evidence; live Foundry enrichment,
full template integration, and acceptance remain separate gates.
