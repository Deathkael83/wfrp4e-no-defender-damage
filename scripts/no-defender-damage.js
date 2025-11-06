// WFRP4e - Conditional Defender Damage (RAW + Counter-Attack + Fast + Rank/Limiter)
// Behaviour:
// - If DEFENDER wins an opposed test, defender deals damage ONLY IF:
//   1) Defender has a Counter-Attack-like talent, with rank R (advances).
//   2) Defender is using a weapon with Fast/Rapida quality.
//   3) In active combat, defender has used this effect fewer than R times THIS ROUND.
// - Otherwise, defender damage is zeroed.
// - Uses official hook if available; falls back to preCreateChatMessage.
// - Conservative edits: only numeric damage fields are touched.

Hooks.once("ready", () => {
  const TALENT_NAMES = [
    "Counter-Attack", "Riposte",   // EN
    "Controattacco", "Ritorsione"  // IT (add aliases if needed)
  ];
  const FAST_QUALITY_NAMES = ["Fast", "Rapida"]; // EN/IT

  const toLower = (s) => String(s || "").trim().toLowerCase();

  // ---------- Usage tracker per round ----------
  const usageState = {
    round: null,
    counts: new Map(), // actorId -> usedCount
  };

  const currentRound = () => (game.combat ? game.combat.round : null);

  const ensureRoundSync = () => {
    const r = currentRound();
    if (usageState.round !== r) {
      usageState.round = r;
      usageState.counts.clear();
    }
  };

  const getUsed = (actorId) => {
    ensureRoundSync();
    return usageState.counts.get(actorId) || 0;
    };

  const incUsed = (actorId) => {
    ensureRoundSync();
    usageState.counts.set(actorId, getUsed(actorId) + 1);
  };

  // Optional: also reset when combat updates (covers round increments)
  Hooks.on("updateCombat", () => ensureRoundSync());

  // ---------- Talent / weapon helpers ----------
  const getCounterTalentRank = (actor) => {
    if (!actor?.items) return 0;
    const names = new Set(TALENT_NAMES.map(toLower));
    let rank = 0;
    for (const it of actor.items) {
      if (it.type !== "talent") continue;
      if (!names.has(toLower(it.name))) continue;
      const adv =
        it.system?.advances?.value ??
        it.system?.advances ??
        it.system?.level ??
        1;
      const val = Number(adv) || 1;
      if (val > rank) rank = val;
    }
    return rank; // 0 = non presente
  };

  const itemHasFastQuality = (item) => {
    if (!item) return false;
    const sys = item.system || item.data?.data || {};
    const raw = sys.qualities?.value ?? sys.qualities ?? [];
    const arr = Array.isArray(raw) ? raw : Object.values(raw);
    const names = new Set(FAST_QUALITY_NAMES.map(toLower));
    return arr.some(q => names.has(toLower(q?.name ?? q)));
  };

  const resolveDefenderActor = (res) => {
    const ref = res?.defender ?? res?.defenderData ?? null;
    if (!ref) return null;
    const actorId = ref.actorId || ref._id || ref.id || null;
    if (actorId && game.actors) {
      const a = game.actors.get(actorId);
      if (a) return a;
    }
    return ref.document || ref.actor || null;
  };

  const resolveDefenderWeapon = (actor, res) => {
    if (!actor) return null;
    const wRef =
      res?.defender?.weapon ||
      res?.defenderWeapon ||
      res?.defenderTest?.weapon ||
      null;
    if (wRef && (wRef.type || wRef.system || wRef.data)) return wRef;

    const wid =
      res?.defender?.weaponId ||
      res?.defenderWeaponId ||
      res?.defenderTest?.weaponId ||
      null;
    if (wid && actor.items) {
      const it = actor.items.get(wid);
      if (it) return it;
    }

    try {
      const melee = actor.items.filter(i => i.type === "weapon");
      const fast = melee.find(itemHasFastQuality);
      return fast || melee[0] || null;
    } catch { return null; }
  };

  // Decision: may defender deal damage now?
  const defenderAllowance = (actor, res) => {
    if (!actor) return { allow: false, reason: "no-actor" };

    const rank = getCounterTalentRank(actor);
    if (rank <= 0) return { allow: false, reason: "no-talent" };

    const weapon = resolveDefenderWeapon(actor, res);
    if (!itemHasFastQuality(weapon)) return { allow: false, reason: "no-fast" };

    // If no active combat, do NOT enforce per-round limit (scene/duel tests etc.)
    if (!game.combat) return { allow: true, rank, used: 0 };

    // Enforce per-round limit: uses per round <= rank
    const actorId = actor.id || actor._id;
    const used = getUsed(actorId);
    if (used >= rank) return { allow: false, reason: "limit-reached", rank, used };
    return { allow: true, rank, used, actorId };
  };

  const zeroDefenderDamage = (res) => {
    if (!res || typeof res !== "object") return;
    if (typeof res.damageFromDefender === "number") res.damageFromDefender = 0;
    if (typeof res.defenderDamage === "number") res.defenderDamage = 0;
    if (Array.isArray(res.additionalDamageFromDefender)) delete res.additionalDamageFromDefender;
  };

  const isDefenderWinner = (res) => toLower(res?.winner) === "defender";

  // ---------- Path A: official WFRP4e hook (preferred) ----------
  const hasSystemHook = Hooks.events?.["wfrp4e:preApplyOpposedResult"];
  if (hasSystemHook) {
    Hooks.on("wfrp4e:preApplyOpposedResult", (data) => {
      try {
        const res = data?.result || {};
        if (!isDefenderWinner(res)) return;

        const defender = resolveDefenderActor(res);
        const { allow, actorId } = defenderAllowance(defender, res);

        if (!allow) {
          zeroDefenderDamage(res);
        } else if (game.combat && actorId) {
          // Count one usage when a valid counter-attack damage is allowed
          incUsed(actorId);
        }
      } catch (e) {
        console.warn("wfrp4e-conditional-defender-damage (system hook):", e);
      }
    });
    console.info("wfrp4e-conditional-defender-damage: active via wfrp4e:preApplyOpposedResult");
    return;
  }

  // ---------- Path B: resilient fallback via preCreateChatMessage ----------
  Hooks.on("preCreateChatMessage", async (msg) => {
    try {
      const flags = msg?.flags ?? msg?.data?.flags ?? {};
      const wf = flags.wfrp4e || flags.WFRP4E || null;
      if (!wf) return;

      const res = wf.opposedResult || wf.opposedTest || wf.opposed || null;
      if (!res || !isDefenderWinner(res)) return;

      const defender = resolveDefenderActor(res);
      const { allow, actorId } = defenderAllowance(defender, res);

      if (!allow) {
        // careful: duplicate then write back only the edited opposed result
        const newFlags = foundry?.utils?.duplicate(flags) ?? JSON.parse(JSON.stringify(flags));
        const t =
          newFlags.wfrp4e?.opposedResult ? newFlags.wfrp4e.opposedResult :
          newFlags.wfrp4e?.opposedTest   ? newFlags.wfrp4e.opposedTest   :
          newFlags.wfrp4e?.opposed       ? newFlags.wfrp4e.opposed       :
          null;
        if (t) {
          zeroDefenderDamage(t);
          if (newFlags.wfrp4e?.opposedResult) newFlags.wfrp4e.opposedResult = t;
          if (newFlags.wfrp4e?.opposedTest)   newFlags.wfrp4e.opposedTest   = t;
          if (newFlags.wfrp4e?.opposed)       newFlags.wfrp4e.opposed       = t;

          if (typeof msg.update === "function") {
            await msg.update({ flags: newFlags });
          } else {
            msg.data.flags = newFlags; // legacy
          }
        }
      } else if (game.combat && actorId) {
        incUsed(actorId);
      }
    } catch (e) {
      console.warn("wfrp4e-conditional-defender-damage (fallback):", e);
    }
  });

  console.info("wfrp4e-conditional-defender-damage: active via preCreateChatMessage fallback");
});
