# kathir world

Babylon.js multiplayer 3D playground. `packages/shared` is the pure sim + protocol + Room,
`packages/client` the Vite renderer, `packages/server` the Node host, `infra/` the Modal deploy.

## Pull requests

- Anything visual gets screenshots in the PR description. Push the images to the orphan
  `screenshots` branch under `pr-<number>/` and link them with
  `https://raw.githubusercontent.com/kathirmeyyappan/world/screenshots/pr-<number>/<file>.png`.
  Capture them headless (Playwright with the swiftshader flags; `window.__world.debug()` and
  `setLook()` are exposed for scripting) and include a mobile shot when the HUD changes.
