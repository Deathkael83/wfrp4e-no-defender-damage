// WFRP4e - Conditional Defender Damage (RAW + Counter-Attack + Fast)
// Logic:
// - If DEFENDER wins the opposed test:
//    - Check defender has a counter-attack talent
//    - Check the weapon used (or an equipped melee weapon) has Fast/Rapida quality
//    - If BOTH true -> allow defender damage; otherwise set defender damage to 0.

Hooks.once("ready", () => {
  const TALENT_NAMES = [
    "Counter-Attack", "Riposte",          // EN
    "Controattacco", "Ritorsione"         // IT (add any alias you use)
  ];
  const FAST_QUALITY_NAMES = [
    "Fast", "Rapida"                       // EN / IT
  ];

  const hasCounterTalent = (actor) => {
    try {
      const names = TALENT_NAMES.map(n => n.toLowerCase());
      return !!actor?.items?.some(i => i.type === "talent" && names.includes((i.name||"").toLowerCase()));
    } catch { return false; }
  };

  // Try to detect if a weapon has the Fast/Rapida quality across common data layouts
  const itemHasFastQuality = (item) => {
    if (!item) return false;
    const sys = item.system || item.data?.data || {};
    // WFRP4e vX commonly stores qualities in system.qualities.value as array of {name, ...}
    const qArr =
      sys?.qualities?.value ||
      sys?.qualities ||
      sys?.weaponGroup?.qualities || // safety net; some forks store differently
      [];
    const flat = Array.isArray(qArr)
      ? qArr
      : Object.values(qArr || {});
    const names = FAST_QUALITY_NAMES.map(n => n.toLowerCase());
    return flat.some(q => names.includes(String(q?.name || q)?.toLowerCase()));
  };

  // Resolve the weapon used by the defender from opposed result payloads (best-effort),
  // else fallback to "any equipped melee weapon with Fast"
  const resolveDefenderWeapon = (actor, opposedResult) => {
    // 1) Try explicit references often present in flags
    const wRef =
      opposedResult?.defender?.weapon ||
      opposedResult?.defenderWeapon ||
      opposedResult?.defenderTest?.weapon ||
      null;

    // If it's an Item-like object coming from flags
    if (wRef && (wRef.type || wRef.system || wRef.data)) return wRef;

    // 2) Try to resolve by itemId if present
    const wid =
      opposedResult?.defender?.weaponId ||
      opposedResult?.defenderWeaponId ||
      opposedResult?.defenderTest?.weaponId ||
      null;
    if (wid && actor?.items) {
      const it = actor.items.get(wid);
      if (it) return it;
    }

    // 3) Fallback: pick an equipped melee weapon with Fast
    try {
      const melee = actor?.items?.filter(i =>
        i.type === "weapon" &&
        ((i.system?.equipped ?? true) || (i.system?.twohanded ?? false) || true) // be permissive on "equipped"
      ) || [];
      // Prefer a Fast weapon if any
      const fast = melee.find(itemHasFastQuality);
      return fast || melee[0] || null;
    } catch { return null; }
  };

  const defenderMayDealDamage = (actor, opposedResult) => {
    if (!actor) return false;
    if (!hasCounterTalent(actor)) return false;
    const weapon = resolveDefenderWeapon(actor, opposedResult);
    return itemHasFastQuality(weapon);
  };

  const zeroDefenderDamage = (res) => {
    if (!res) return;
    if ("damageFromDefender" in res) res.damageFromDefender = 0;
    if ("defenderDamage" in res) res.defenderDamage = 0;
    if (Array.isArray(res.additionalDamageFromDefender)) res.additionalDamageFromDefender = [];
  };

  // Path A: official system hook (if exposed by your WFRP4e version)
  const hasSystemHook = Hooks.events?.["wfrp4e:preApplyOpposedResult"];
  if (hasSystemHook) {
    Hooks.on("wfrp4e:preApplyOpposedResult", (data) => {
      try {
        const res = data?.result || {};
        if (String(res?.winner).toLowerCase() !== "defender") return;
        const defender = res.defender?.document || res.defender || null;
        const allow = defenderMayDealDamage(defender, res);
        if (!allow) zeroDefenderDamage(res);
      } catch (e) {
        console.warn("wfrp4e-conditional-defender-damage (hook):", e);
      }
    });
    console.info("wfrp4e-conditional-defender-damage: active via wfrp4e:preApplyOpposedResult");
    return;
  }

  // Path B: resilient fallback — sanitize opposed result in chat flags BEFORE damage is applied
  Hooks.on("preCreateChatMessage", async (msg) => {
    try {
      const flags = msg?.flags ?? msg?.data?.flags ?? {};
      const wf = flags.wfrp4e || flags["WFRP4E"] || null;
      if (!wf) return;

      const res = wf.opposedResult || wf.opposedTest || wf.opposed || null;
      if (!res) return;

      if (String(res?.winner).toLowerCase() !== "defender") return;

      // Resolve defender Actor
      const defRef = res.defender || res.defenderData || null;
      let defender = null;
      const actorId = defRef?.actorId || defRef?._id || defRef?.id || null;
      if (actorId && game.actors) defender = game.actors.get(actorId);
      if (!defender && defRef?.document) defender = defRef.document;
      if (!defender && defRef?.actor) defender = defRef.actor;

      const allow = defenderMayDealDamage(defender, res);
      if (!allow) {
        zeroDefenderDamage(res);
        if (flags.wfrp4e?.opposedResult) flags.wfrp4e.opposedResult = res;
        if (flags.wfrp4e?.opposedTest)   flags.wfrp4e.opposedTest   = res;
        if (flags.wfrp4e?.opposed)       flags.wfrp4e.opposed       = res;

        if (msg.data?.flags?.wfrp4e?.opposedResult) msg.data.flags.wfrp4e.opposedResult = res;
        if (msg.data?.flags?.wfrp4e?.opposedTest)   msg.data.flags.wfrp4e.opposedTest   = res;
        if (msg.data?.flags?.wfrp4e?.opposed)       msg.data.flags.wfrp4e.opposed       = res;
      }
    } catch (e) {
      console.warn("wfrp4e-conditional-defender-damage (preCreateChatMessage):", e);
    }
  });

  console.info("wfrp4e-conditional-defender-damage: active via preCreateChatMessage fallback");
});
