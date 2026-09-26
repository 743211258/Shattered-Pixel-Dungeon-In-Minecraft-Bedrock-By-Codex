# Porting Status

## Source Coverage

- Reviewed all 65 Java source files and all 36 Forge resource files under the repository's `java/` and `resources/` source roots (the supplied project uses these roots instead of `src/main`).
- Traced item registration, all eight client-to-server packet semantics, the server tick managers, damage/heal handlers, the custom projectile, all four artifact classes, all four wand classes, the Viscosity Mixin, renderer, GUI, recipes, translations, and image assets.
- `Config`, `ScrollOfUpgrade`, `EXAMPLE_ITEM`, and the `UPGRADE_KEY` have no observable mod behavior beyond unused/example scaffolding, so no Bedrock content was created for them.

## Completed

- An isolated Bedrock project with behavior pack, resource pack, TypeScript source, validation, and `.mcaddon` packaging.
- All eight registered Forge items: four energy wands and four artifacts.
- Per-stack persistent cooldown energy for wands (4 maximum, 300 ticks each) and artifacts (1 maximum: Rose 2400, Hourglass 900, Armband 6000).
- Blast Wave damage, armor-scaled knockback, collision stop, and explosion particles; Fireblast 20×10 cone, lava conversion, ignition-equivalent fire effect, and Slowness IV; Lightning raycast plus depth-three 5-block chaining; Regrowth cone, 60-tick rooting, oak-wood enclosure, and restoration of replaced blocks.
- Chalice damage/buffs/freeze/no-healing timers; Hourglass target freeze and self-invisibility/invulnerability; Armband equipment transfer; Rose tame buffed wolf, target command, taunt state, wolf movement/attack, and taunt pull.
- Freeze/root movement and camera restriction for players, frozen/rooted position locking for all entities, invincibility damage cancellation, and no-healing cancellation.
- All original item PNGs, both original locales, and all six original recipes. The Forge source contains no blocks, sounds, entity models, animations, loot tables, or additional recipes to migrate. The `a_bubble.png` and four effect-icon PNGs are source assets exclusively used by the unavailable Viscosity/enchantment HUD path and are therefore documented instead of copied as unused files.

## Forge → Bedrock Mapping

| Forge subsystem | Bedrock implementation |
| --- | --- |
| `EnergyWand`/`CooldownSystem` NBT | non-stackable `ItemStack` dynamic properties (`energy`, `last`) |
| Forge item right-click and packets | registered Script API item custom components, server-authoritative `onUse` |
| server tick mechanics | `system.runInterval(..., 1)` |
| effects/capabilities/static maps | script state maps plus native effects/input permissions |
| `BlastWave` custom projectile/renderer | scripted ray-traced projectile path, particles, radial damage and impulse |
| Dried Rose `Wolf#setTarget`/taunt | tameable wolf plus server-scripted target chase/attack and nearby taunt pull |
| Forge recipes/assets/lang | Bedrock shaped recipes, item atlas, and `.lang` files |

## Mixin Reimplementations

### Viscosity HUD mixin

Original Forge behavior: the `ViscosityMixin` replaces hearts predicted to be lost to deferred Viscosity damage with `a_bubble.png`; the enchantment moves all qualifying chest-armor damage into ten damage-over-time installments (every 60 ticks).

Bedrock implementation: no direct implementation. Bedrock custom Add-Ons cannot register a survival enchantment with Forge-like chest-slot behavior nor replace individual vanilla heart rendering from a behavior/resource pack. This is documented rather than simulated with an unsupported API.

Remaining difference: Viscosity is unavailable in Bedrock; the bubble-heart UI and custom `damage_over_time` death type are unavailable.

## Known Behavioral Differences

- Bedrock has no arbitrary client keybinding API for add-ons. Forge's offhand Z/X/1/C bindings are mapped to directly using a main-hand item; Rose uses sneak-use for taunt and normal use for summon/command, Hourglass uses sneak-use for self-freeze/invulnerability.
- Bedrock cannot force native mob AI targets through Script API. The commanded wolf and taunt are reproduced by server-side movement, proximity damage, and pull behavior, rather than direct AI target assignment.
- Bedrock does not expose Java's forced-chunk API. Summoned wolves follow normal Bedrock simulation-distance rules.
- The Forge custom thrown-item entity is reproduced with a traced, particle-visible cast rather than a network-synced custom projectile entity.
- Bedrock's standard UI does not permit the Forge hotbar/inventory energy count, taunt charge number, cooldown fill, encyclopedia GUI, or Mixin heart overlay to be injected. The current selected item exposes energy through the action bar.
- Fireblast uses lava and `setOnFire`, the closest exposed equivalent to the Forge fire placement loop; exact block-surface ignition behavior differs.

## Unsupported Forge Features

- `Viscosity` custom enchantment, custom damage type tags, and its heart-rendering Mixin: see above.
- Forge's written-book-on-first-login and P-key Encyclopedia GUI: Bedrock behavior packs cannot create the same custom client screen. The README provides the equivalent usage documentation.

## Build Status

- `npm run typecheck` passes against the installed official `@minecraft/server` 2.10.0 types.
- `npm run build` compiles `src/main.ts`, validates all JSON/manifests/resource bindings, and emits `build/spdim-bedrock.mcaddon`. The packager uses Java's standards-compliant ZIP writer; its harmless `META-INF/MANIFEST.MF` metadata is ignored by Bedrock.

## Runtime/Test Status

- Static Script API type validation and pack-structure validation are automated.
- Minecraft Bedrock itself is not present in this environment, so in-game import/runtime log testing has not been performed. Test with a Script API-enabled world and inspect Content Log after import.

## Remaining Work

- Run the packaged add-on in Minecraft Bedrock and resolve any engine-version/content-log issues specific to the target client.
- If Microsoft exposes custom enchantment registration or survival HUD hooks in a future stable API, implement Viscosity and the bubble-heart visualization.
