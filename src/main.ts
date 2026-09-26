import {
  BlockPermutation, Entity, EntityComponentTypes, EntityDamageCause, EntityEquippableComponent,
  EntityHealthComponent, EntityInventoryComponent, EntityTameableComponent,
  EquipmentSlot, InputPermissionCategory, ItemStack, Player, system, world,
} from "@minecraft/server";

/*
 * SPDIM's server-authoritative mechanics. Timers are game ticks (20/s), matching
 * the Forge constants. Item dynamic properties make per-stack energy survive
 * inventory moves and world reloads.
 */
const TICKS = { wand: 300, rose: 2400, hourglass: 900, armband: 6000 };
const frozen = new Map<string, { entity: Entity; position: { x: number; y: number; z: number }; until: number }>();
const rooted = new Map<string, { entity: Entity; position: { x: number; y: number; z: number }; until: number; blocks: { x: number; y: number; z: number; permutation: BlockPermutation }[] }>();
const invincible = new Map<string, number>();
const noHealing = new Map<string, number>();
const viscosity = new Map<string, { entity: Entity; damage: number; next: number }>();
const summons = new Map<string, { owner: Player; wolf: Entity; taunt: boolean; target?: Entity }>();

function tick(): number { return system.currentTick; }
function alive(entity: Entity | undefined): entity is Entity { return !!entity && entity.isValid; }
function distSq(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const x = a.x - b.x, y = a.y - b.y, z = a.z - b.z; return x * x + y * y + z * z;
}
function inventory(player: Player): EntityInventoryComponent | undefined {
  return player.getComponent(EntityComponentTypes.Inventory) as EntityInventoryComponent | undefined;
}
function selectedStack(player: Player): ItemStack | undefined { return inventory(player)?.container.getItem(player.selectedSlotIndex); }
function saveSelected(player: Player, stack: ItemStack): void { inventory(player)?.container.setItem(player.selectedSlotIndex, stack); }
function energy(stack: ItemStack, max: number, cooldown: number): boolean {
  const now = tick();
  let current = Number(stack.getDynamicProperty("spdim:energy") ?? max);
  let last = Number(stack.getDynamicProperty("spdim:last") ?? now);
  while (current < max && now - last >= cooldown) { current++; last += cooldown; }
  stack.setDynamicProperties({ "spdim:energy": current, "spdim:last": last, "spdim:max": max, "spdim:cooldown": cooldown });
  return current > 0;
}
function consume(stack: ItemStack): void {
  const now = tick(), current = Number(stack.getDynamicProperty("spdim:energy") ?? 0);
  stack.setDynamicProperties({ "spdim:energy": Math.max(0, current - 1), "spdim:last": now });
}
function showEnergy(player: Player, stack: ItemStack, max: number, cooldown: number): boolean {
  const ready = energy(stack, max, cooldown);
  const current = Number(stack.getDynamicProperty("spdim:energy"));
  player.onScreenDisplay.setActionBar(`§dSPDIM §7Energy: §f${current}/${max}${ready ? "" : " §8(recharging)"}`);
  saveSelected(player, stack);
  return ready;
}
function targetFromView(player: Player, range: number): Entity | undefined {
  return player.getEntitiesFromViewDirection({ maxDistance: range }).map(hit => hit.entity).find(e => e.id !== player.id);
}
function effect(entity: Entity, id: string, duration: number, amplifier = 0): void { entity.addEffect(id, duration, { amplifier, showParticles: false }); }
function health(entity: Entity): EntityHealthComponent | undefined { return entity.getComponent(EntityComponentTypes.Health) as EntityHealthComponent | undefined; }
function message(player: Player, text: string): void { player.onScreenDisplay.setActionBar(`§dSPDIM §r${text}`); }

function freeze(entity: Entity, duration: number): void {
  frozen.set(entity.id, { entity, position: { ...entity.location }, until: tick() + duration });
  if (entity.typeId === "minecraft:player") {
    const player = entity as Player;
    player.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, false);
    player.inputPermissions.setPermissionCategory(InputPermissionCategory.Camera, false);
  }
  effect(entity, "minecraft:slowness", duration, 255);
}
function root(entity: Entity, duration: number, wood: boolean): void {
  const blocks: { x: number; y: number; z: number; permutation: BlockPermutation }[] = [];
  if (wood) {
    const l = entity.location;
    for (let x = Math.floor(l.x) - 1; x <= Math.floor(l.x) + 1; x++) for (let z = Math.floor(l.z) - 1; z <= Math.floor(l.z) + 1; z++) {
      const p = { x, y: Math.floor(l.y), z }, block = entity.dimension.getBlock(p);
      if (block) { blocks.push({ ...p, permutation: block.permutation }); block.setPermutation(BlockPermutation.resolve("minecraft:oak_wood")); }
    }
  }
  rooted.set(entity.id, { entity, position: { ...entity.location }, until: tick() + duration, blocks });
  if (entity.typeId === "minecraft:player") (entity as Player).inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, false);
}
function blastWave(player: Player): void {
  const origin = player.getHeadLocation(), direction = player.getViewDirection();
  // A visible, gravity-free firework trace replaces Forge's custom projectile renderer.
  for (let d = 1; d <= 100; d += 2) {
    const p = { x: origin.x + direction.x * d, y: origin.y + direction.y * d, z: origin.z + direction.z * d };
    player.dimension.spawnParticle("minecraft:basic_flame_particle", p);
    const block = player.dimension.getBlockFromRay(origin, direction, { maxDistance: d });
    if (block && d > 2) { explode(player, block.block.location); return; }
    const hit = player.dimension.getEntitiesFromRay(origin, direction, { maxDistance: d }).find(e => e.entity.id !== player.id);
    if (hit) { explode(player, hit.entity.location); return; }
  }
  explode(player, { x: origin.x + direction.x * 100, y: origin.y + direction.y * 100, z: origin.z + direction.z * 100 });
}
function explode(owner: Player, location: { x: number; y: number; z: number }): void {
  owner.dimension.spawnParticle("minecraft:huge_explosion_emitter", location);
  for (const entity of owner.dimension.getEntities({ location, maxDistance: 5 })) {
    if (entity.id === owner.id || isInvincible(entity)) continue;
    const d = Math.sqrt(distSq(entity.location, location));
    const armor = (entity.getComponent(EntityComponentTypes.Equippable) as EntityEquippableComponent | undefined)?.totalArmor ?? 0;
    entity.applyDamage(2 + armor, { cause: EntityDamageCause.entityExplosion, damagingEntity: owner });
    if (d > 0.01) entity.applyImpulse({ x: ((entity.location.x - location.x) / d) * Math.max(0, 10 - armor * .2) * (1 - d * d / 25), y: 0.55, z: ((entity.location.z - location.z) / d) * Math.max(0, 10 - armor * .2) * (1 - d * d / 25) });
  }
}
function fireblast(player: Player): void {
  const origin = player.getHeadLocation(), forward = player.getViewDirection();
  for (const entity of player.dimension.getEntities({ location: origin, maxDistance: 23 })) {
    if (entity.id === player.id || isInvincible(entity)) continue;
    const dx = entity.location.x - origin.x, dy = entity.location.y - origin.y, dz = entity.location.z - origin.z;
    const projection = dx * forward.x + dy * forward.y + dz * forward.z;
    if (projection <= 0 || projection > 20 || (dx * dx + dy * dy + dz * dz - projection * projection) > (projection / 2) ** 2) continue;
    effect(entity, "minecraft:slowness", 150, 3); entity.setOnFire(8, true);
    const p = entity.location; for (let y = 0; y < 2; y++) for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
      const block = player.dimension.getBlock({ x: Math.floor(p.x) + x, y: Math.floor(p.y) + y, z: Math.floor(p.z) + z });
      if (block) block.setPermutation(BlockPermutation.resolve("minecraft:lava"));
    }
  }
  for (let d = 1; d <= 20; d++) player.dimension.spawnParticle("minecraft:basic_flame_particle", { x: origin.x + forward.x * d, y: origin.y + forward.y * d, z: origin.z + forward.z * d });
}
function lightning(player: Player): void {
  const first = targetFromView(player, 50), point = first?.location ?? player.getBlockFromViewDirection({ maxDistance: 50 })?.block.location;
  if (!point) return;
  const hit = new Set<string>();
  const chain = (location: { x: number; y: number; z: number }, depth: number): void => {
    if (depth <= 0) return;
    const candidates = player.dimension.getEntities({ location, maxDistance: 5 }).filter(e => e.id !== player.id && !hit.has(e.id) && !isInvincible(e));
    for (const entity of candidates) { hit.add(entity.id); entity.applyDamage(2.5, { cause: EntityDamageCause.lightning, damagingEntity: player }); player.dimension.spawnEntity("minecraft:lightning_bolt", entity.location); chain(entity.location, depth - 1); }
  };
  player.dimension.spawnEntity("minecraft:lightning_bolt", point); if (first) { hit.add(first.id); first.applyDamage(2.5, { cause: EntityDamageCause.lightning, damagingEntity: player }); } chain(point, 3);
}
function regrowth(player: Player): void {
  const origin = player.getHeadLocation(), forward = player.getViewDirection();
  for (const entity of player.dimension.getEntities({ location: origin, maxDistance: 23 })) {
    if (entity.id === player.id || isInvincible(entity)) continue;
    const dx = entity.location.x - origin.x, dy = entity.location.y - origin.y, dz = entity.location.z - origin.z, projection = dx * forward.x + dy * forward.y + dz * forward.z;
    if (projection > 0 && projection <= 20 && dx * dx + dy * dy + dz * dz - projection * projection <= (projection / 2) ** 2) root(entity, 60, true);
  }
}
function isInvincible(entity: Entity): boolean { return (invincible.get(entity.id) ?? 0) > tick(); }
function summonRose(player: Player): void {
  const old = summons.get(player.id);
  if (!old) {
    const wolf = player.dimension.spawnEntity("minecraft:wolf", player.location);
    (wolf.getComponent(EntityComponentTypes.Tameable) as EntityTameableComponent | undefined)?.tame(player);
    effect(wolf, "minecraft:strength", 2147483647, 3); effect(wolf, "minecraft:resistance", 2147483647, 3); effect(wolf, "minecraft:speed", 2147483647, 1); effect(wolf, "minecraft:regeneration", 2147483647, 1);
    summons.set(player.id, { owner: player, wolf, taunt: false }); message(player, "Dried Rose summoned its wolf. Sneak-use to toggle taunt.");
  } else if (player.isSneaking) { old.taunt = !old.taunt; message(player, `Wolf taunt ${old.taunt ? "ON" : "OFF"}.`); }
  else { const target = targetFromView(player, 100); if (target) { old.target = target; message(player, "Wolf target locked."); } else message(player, "Look at an enemy to command the wolf."); }
}
function steal(player: Player): void {
  const target = targetFromView(player, 6000); if (!target) { message(player, "No target in sight."); return; }
  const equipped = target.getComponent(EntityComponentTypes.Equippable) as EntityEquippableComponent | undefined;
  if (!equipped) { message(player, "Target has no equipment."); return; }
  const own = inventory(player)?.container; if (!own) return;
  for (const slot of [EquipmentSlot.Mainhand, EquipmentSlot.Offhand, EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet]) {
    const item = equipped.getEquipment(slot); if (item) { equipped.setEquipment(slot); const remainder = own.addItem(item); if (remainder) player.dimension.spawnItem(remainder, player.location); }
  }
}

system.beforeEvents.startup.subscribe(init => {
  init.itemComponentRegistry.registerCustomComponent("spdim:blast_wave", { onUse: e => { const s = selectedStack(e.source); if (s && showEnergy(e.source, s, 4, TICKS.wand)) { blastWave(e.source); consume(s); saveSelected(e.source, s); } } });
  init.itemComponentRegistry.registerCustomComponent("spdim:fireblast", { onUse: e => { const s = selectedStack(e.source); if (s && showEnergy(e.source, s, 4, TICKS.wand)) { fireblast(e.source); consume(s); saveSelected(e.source, s); } } });
  init.itemComponentRegistry.registerCustomComponent("spdim:lightning", { onUse: e => { const s = selectedStack(e.source); if (s && showEnergy(e.source, s, 4, TICKS.wand)) { lightning(e.source); consume(s); saveSelected(e.source, s); } } });
  init.itemComponentRegistry.registerCustomComponent("spdim:regrowth", { onUse: e => { const s = selectedStack(e.source); if (s && showEnergy(e.source, s, 4, TICKS.wand)) { regrowth(e.source); consume(s); saveSelected(e.source, s); } } });
  init.itemComponentRegistry.registerCustomComponent("spdim:chalice", { onUse: e => { const h = health(e.source); if (!h) return; h.setCurrentValue(Math.max(0.5, h.currentValue - 19)); effect(e.source, "minecraft:speed", 3600, 1); effect(e.source, "minecraft:strength", 3600, 1); effect(e.source, "minecraft:jump_boost", 3600, 1); effect(e.source, "minecraft:night_vision", 3600); effect(e.source, "minecraft:absorption", 3600, 3); effect(e.source, "minecraft:resistance", 3600, 3); freeze(e.source, 200); noHealing.set(e.source.id, tick() + 6000); message(e.source, "The Chalice demands blood."); } });
  init.itemComponentRegistry.registerCustomComponent("spdim:hourglass", { onUse: e => { const s = selectedStack(e.source); if (!s || !showEnergy(e.source, s, 1, TICKS.hourglass)) return; if (e.source.isSneaking) { invincible.set(e.source.id, tick() + 100); effect(e.source, "minecraft:invisibility", 200); message(e.source, "You are untargetable for 5 seconds."); } else { const target = targetFromView(e.source, 50); if (target && !isInvincible(target)) { freeze(target, 200); message(e.source, "Target frozen for 10 seconds."); } else return; } consume(s); saveSelected(e.source, s); } });
  init.itemComponentRegistry.registerCustomComponent("spdim:dried_rose", { onUse: e => summonRose(e.source) });
  init.itemComponentRegistry.registerCustomComponent("spdim:steal", { onUse: e => { const s = selectedStack(e.source); if (s && showEnergy(e.source, s, 1, TICKS.armband)) { steal(e.source); consume(s); saveSelected(e.source, s); } } });
});

world.beforeEvents.entityHurt.subscribe(e => { if (isInvincible(e.hurtEntity) || rooted.has(e.hurtEntity.id)) e.cancel = true; });
world.beforeEvents.entityHeal.subscribe(e => { if ((noHealing.get(e.healedEntity.id) ?? 0) > tick()) e.cancel = true; });

system.runInterval(() => {
  const now = tick();
  for (const [id, state] of frozen) { if (!alive(state.entity) || now >= state.until) { if (state.entity.typeId === "minecraft:player" && alive(state.entity)) { const p = state.entity as Player; p.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, true); p.inputPermissions.setPermissionCategory(InputPermissionCategory.Camera, true); } frozen.delete(id); } else { state.entity.teleport(state.position); state.entity.clearVelocity(); } }
  for (const [id, state] of rooted) { if (!alive(state.entity) || now >= state.until) { if (alive(state.entity) && state.entity.typeId === "minecraft:player") (state.entity as Player).inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, true); for (const block of state.blocks) state.entity.dimension.getBlock(block)?.setPermutation(block.permutation); rooted.delete(id); } else { state.entity.teleport(state.position); state.entity.clearVelocity(); } }
  for (const [id, until] of invincible) if (now >= until) invincible.delete(id);
  for (const [id, until] of noHealing) if (now >= until) noHealing.delete(id);
  for (const [ownerId, summon] of summons) {
    if (!alive(summon.owner) || !alive(summon.wolf)) { summons.delete(ownerId); continue; }
    const target = summon.target;
    if (alive(target) && distSq(summon.wolf.location, target.location) < 10000) { const dx = target.location.x - summon.wolf.location.x, dz = target.location.z - summon.wolf.location.z, d = Math.hypot(dx, dz) || 1; summon.wolf.applyImpulse({ x: dx / d * .12, y: 0, z: dz / d * .12 }); if (distSq(summon.wolf.location, target.location) < 4 && now % 10 === 0) target.applyDamage(4, { cause: EntityDamageCause.entityAttack, damagingEntity: summon.wolf }); }
    if (summon.taunt) { effect(summon.wolf, "minecraft:glowing", 2); for (const mob of summon.wolf.dimension.getEntities({ location: summon.wolf.location, maxDistance: 16 })) if (mob.id !== summon.wolf.id && mob.id !== summon.owner.id && mob.typeId !== "minecraft:player") { const dx = summon.wolf.location.x - mob.location.x, dz = summon.wolf.location.z - mob.location.z, d = Math.hypot(dx, dz) || 1; mob.applyImpulse({ x: dx / d * .05, y: 0, z: dz / d * .05 }); } }
  }
}, 1);

world.afterEvents.playerSpawn.subscribe(e => { if (e.initialSpawn) e.player.sendMessage("§dSPDIM Bedrock§r loaded. Use the custom wands and artifacts directly from your main hand."); });
