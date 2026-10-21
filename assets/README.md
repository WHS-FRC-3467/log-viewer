# Custom assets

Add custom robot models, fields and joysticks here; folders with the same name as a bundled asset replace it.

Format (same as AdvantageScope custom assets): one folder per asset, named with a type prefix:

- `Robot_<Name>/config.json` + `model.glb` (+ optional component models)
- `Field3d_<Name>/config.json` + `model.glb`
- `Field2d_<Name>/config.json` + `image.png`
- `Joystick_<Name>/config.json` + images

Docs: https://docs.advantagescope.org/more-features/custom-assets

The build merges these over the bundled assets and generates `viewer/assets/index.json`. Dotfiles and README files are ignored.

## Default robot

Lite has no "default robot" setting: new robot items use the first model in its sorted list, and names starting with a year sort first. That is why `Robot_Perry_2026/config.json` is named `"2026 Perry"` here (it is `"Perry"` in the robot code repo, WHS-FRC-3467/Skip-5.16-Perry `ascope_assets/`).

## Keeping models small

GitHub Pages sites are limited to 1 GB, so large CAD exports are worth shrinking. Lite does not register Draco or Meshopt decoders, so don't use those; mesh quantization works and roughly halves file size:

```
npx @gltf-transform/cli dedup in.glb a.glb
npx @gltf-transform/cli weld a.glb b.glb
npx @gltf-transform/cli quantize b.glb out.glb
```

Unused bundled assets can be left out of the build with `excludeBundledAssets` in `site.config.json`.
