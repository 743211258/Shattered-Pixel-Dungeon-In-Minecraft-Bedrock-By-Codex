# SPDIM Bedrock Add-On

This is the separate Bedrock port of the Forge SPDIM mod. Import `build/spdim-bedrock.mcaddon` into current Minecraft Bedrock, then enable both packs in a world. The add-on requires Script API support and a game version compatible with `@minecraft/server` 2.10.0.

## Build

```bash
npm install
npm run build
```

`npm run build` compiles the Script API source, validates pack JSON/manifest/icon links, and creates `build/spdim-bedrock.mcaddon`.

## Use

Custom items appear under Equipment in Creative and retain their original crafting recipes. Use them from the main hand.

- Wands: Blast Wave, Fireblast, Lightning, and Regrowth have four energy charges and regain one charge every 300 ticks.
- Timekeeper's Hourglass: use to freeze a viewed target for 200 ticks; sneak-use for 100 ticks of invisibility and damage immunity. It recharges in 900 ticks.
- Chalice of Blood: drains 19 health, then grants the original temporary buffs, freezes its user for 200 ticks, and prevents healing for 6000 ticks.
- Dried Rose: use to summon a permanently buffed tame wolf. Use while looking at an entity to command it; sneak-use toggles its 16-block taunt aura.
- Master Thieves' Armband: use while looking at an equipped entity to transfer its equipment. It recharges in 6000 ticks.

See `PORTING.md` for fidelity notes and Bedrock-specific interaction changes.
