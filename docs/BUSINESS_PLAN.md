# Aweborn — Economy & Business Plan (DRAFT v0.3, 2026-10-13)

> [!IMPORTANT]
> Draft for Alex. **Not in the repo**: the repo is public, and MASTER_PLAN keeps business and admin records in Google Drive. Every number is an assumption to check. Provider prices are list prices as of Oct 2026. Not legal or tax advice: the entity and tax questions in §8 need an attorney and a CPA.

## 1. The one-paragraph pitch

**Aweborn is a non-profit, incorporated with 501(c)(3) status.** Its mission is research into making work humane: understanding people's personalities and matching them into teams that work, so a working day feels like a regular good day instead of hell. The game is how the mission funds itself and how it meets people.

Aweborn is a shared universe where curiosity becomes creative energy. Players explore for free. Everything they find sparks **awe**, and awe is harvested as **mana**. **Dreaming is free:** ghost creations, offline building, anything not yet made real. **Manifesting costs mana:** making things real in a solid world, generating characters, terrain, sounds and whole new worlds. Mana costs money, priced from real costs plus a margin. The surplus pays for operations, support and the research.

## 2. What the design guarantees (and what it can't)

No plan can *guarantee* profit. This one guarantees that losses are bounded and the break-even point is known:

1. **Every mana sold is priced above its fully loaded cost.** Generation is priced at about 4× its direct cost, which is roughly a 75% gross margin.
2. **Free mana is capped.** Awe can only mint from a **Curiosity Budget** tied to revenue (§4). Generosity can never outrun income.
3. **Losses are limited to fixed costs** (people + baseline infra). Selling more never loses money.
4. **Break-even is a tracked number:** about **110k MAU** at baseline assumptions (§6). Card sales, organizations and grants bring it closer.

## 3. Mana pricing

**$1 = 1,000 mana** (1 mana = $0.001). Formula: `mana = ceil(direct_cost_usd × 1000 × M)`, with **M = 4** for generation. Non-compute acts get small flat prices that keep the "manifesting has weight" feel.

| Act | Direct cost (est.) | Mana | ≈ Player price |
|---|---|---|---|
| Place / move an object in a solid world | ~$0 | 1–5 | < 1¢ |
| Change a world's physics (gravity, water…) | ~$0 | 50 | 5¢ |
| Image / texture | ~$0.04 | 200 | 20¢ |
| Sound effect (ElevenLabs list: $0.12/gen) | ~$0.13 | 500 | 50¢ |
| Music loop 30–60 s | ~$0.30 | 1,200 | $1.20 |
| Textured object mesh (Tripo list: $0.20–0.70) | ~$0.40 | 1,600 | $1.60 |
| Terrain patch (AI) | ~$0.50 | 2,000 | $2.00 |
| Rigged character mesh (Meshy/Tripo + rigging) | ~$0.90 | 3,600 | $3.60 |
| **Manifest a brand-new world** (bundle: 4 terrain, 10 objects, 2 characters, 5 sounds, skybox, music) | ~$8.80 | ~35,000 | **~$35** |

Mana packs (Stripe takes 2.9% + 30¢, so $5 is the minimum): $5 → 5,000 · $10 → 10,500 · $25 → 27,500 · $50 → 57,500.

> [!NOTE]
> Prices are set by *output* (a mesh, a sound, a world), not by provider. Change providers and only the cost column moves. M is recalculated quarterly from actual costs.

### Three numbers

| Number | What it is | Fed by | Spent by |
|---|---|---|---|
| **High-water line** | The farthest mana has ever spread. Sets the Frontier and never falls | Every mana that flows anywhere: purchases, donations, awe | Nobody (it's a record) |
| **Shared pool** | The universe's common energy | Donations, a share of awe, Resonance spill | Anyone, at the shared flow rate |
| **Personal reserve** | Your own mana | Purchases, awe from the Curiosity Budget, (later) earnings from visitors, which stay in-game and never cash out | You, and the people you choose to manifest with |

### Resonance: a bigger reserve lifts the people around you

Alex's requirement: personally empowering *and* universe-empowering, because emotions are contagious and manifesting together is the point. Proposal:

1. **Glow.** Your star's aura brightens with the mana you've **channeled recently** (spent, pooled, given), not with your reserve. Hoarding doesn't glow; using mana does. It's visible and beautiful, but it gives no status or rank. *(Decided 2026-10-13, Q9 b.)*
2. **Contagious curiosity.** Players inside a glowing player's aura earn more awe (e.g. up to +25%). It's paid from the Curiosity Budget, so it costs nothing extra.
3. **Ripple.** When anyone manifests, a small share (e.g. 5% of the mana spent) spills to the players nearby. At M = 4, 5% of the mana costs at most ~1.25% of the price in real compute, so it's paid from margin. Each recipient has a daily cap.
4. **Manifesting together.** Players can pool reserves into one creation. Group manifestations get a bonus (e.g. +10% from the Curiosity Budget) and credit every contributor on the creation.

Caps and Phase 09 (server-authoritative movement) stop alt accounts from farming ripples and auras.

## 4. Awe: how curiosity creates mana without losing money

Alex's intent: awe generates mana. The collective feels it (a little), it spreads, and following your curiosity increases your ability to create.

**Proposed mechanism: the Curiosity Budget.**
- Each month the company sets aside a budget, e.g. **10% of last month's revenue, in real-cost terms**, with a fixed floor at launch.
- Awe events mint spendable mana from that budget. Curiosity decides *who the energy flows through*. The budget decides *how much exists*.
- Because mana sells at about 4× cost, $1 of real budget backs about **4,000 mana** of manifesting. Generosity is cheap to fund.
- Awe also **raises the high-water line**. That's free, since it's only the Frontier's size, so every discovery visibly grows reality for everyone.
- "Felt by the collective": a small share of each awe event (e.g. 10–20%) goes to the shared pool, and shared awe (exploring together) gets more.
- New players receive a **first-light gift** (e.g. 2,000 mana, ≤ $0.50 real cost) so their first manifestation happens before any payment. This is the acquisition cost.
- When the budget runs low, the universe "dims" (ROADMAP's visuals for a low pool) and awe yields drop. The economy stays solvent, and the game says so in its own language.
- **Confirmed by Alex (2026-10-13).** Set by hand monthly at first. **Later: automated** from the statements: Stripe balance transactions (revenue net of fees) + AWS Cost Explorer + provider invoices → budget for next month, with a dashboard and a manual override.

## 5. Revenue streams

| Stream | Model | Notes |
|---|---|---|
| **Mana** (core) | Packs, later an optional monthly "patron" plan with a mana stipend | Creators are a self-selected audience. Subscription conversion is often 12–18% of engaged players vs 1.5–3.5% for one-off purchases. **A purchase, not a donation** |
| **Donations** | Pure gifts to the shared pool / Frontier, with no personal mana back | Tax-deductible as a charitable gift (no goods received) |
| **NFC cards** | Curated sets ($5–10/pack) + print-your-world | Unit cost ~$1–2; the pilot quote from DTB is pending |
| **Organizations** | Events, schools and companies commission worlds + card runs | Higher-ticket B2B; also outreach |
| **Grants** | Arts, education, workplace/organizational research | Fits the mission and the research arm |
| **Impact funding** | Program-related investments, recoverable grants, research partnerships with companies that want better teams | The non-profit version of "investors": no equity |
| **Research (later)** | Team matching from opt-in personality signals | Not in base-case revenue. Needs explicit consent (§8) |

## 6. Unit economics & scenarios (monthly, baseline assumptions)

Assumptions: **3% of MAU pay**, **$12 average spend per payer per month**, all bought mana gets spent on generation (worst case for cost), Curiosity Budget = 10% of revenue, infra about $0.03/MAU + $100 base.

Per payer: $12.00 revenue − $0.65 card fees − $3.00 generation cost − $1.20 Curiosity Budget = **$7.15 contribution (~60%)**.

| MAU | Payers | Revenue | Contribution | Infra | Before people |
|---|---|---|---|---|---|
| 1,000 | 30 | $360 | $215 | $130 | **$85** |
| 10,000 | 300 | $3,600 | $2,145 | $400 | **$1,745** |
| 100,000 | 3,000 | $36,000 | $21,450 | $3,100 | **$18,350** |

**Break-even** against an assumed $20k/month team: about **110k MAU** at baseline. At 6% conversion (creator audience + patron plan) it's about 55k. Each world bought at ~$35 adds about $26 of contribution.

## 7. Costs

COGS: AI APIs, storage/CDN for generated assets, content moderation, card fees. Infrastructure today: one Lightsail VPS + AWS (about $50–100/month). Later: support, people, research.

## 8. Open questions before this goes to anyone

1. **Entity: resolved.** Aweborn is incorporated and holds **501(c)(3) status** (IRS confirmation in this folder). Still for the attorney: selling game mana may count as **unrelated business income** (taxed, and if it becomes large it can threaten exempt status). The common answer is a **for-profit subsidiary** wholly owned by the non-profit that runs the game and sends profits up. Decide before revenue gets meaningful.
2. **Tax:** buying mana for your own use is a **purchase, not a donation**. Receipts, Stripe labels and the Terms page must say so (today's Terms page calls all payments donations). Only gifts to the shared pool are deductible. → CPA.
3. **"Donor advantages are cosmetic only" (resolved Aug 19)** collides with paying to manifest. Proposed reframe: *money buys manifesting, never power over other players.* (Resonance fits: a big reserve lifts others instead of outranking them.)
4. **Research and privacy:** the privacy page promises no tracking. Personality modelling needs separate, explicit, revocable opt-in; probably ethics review (IRB) with academic partners. The research is the mission, so design consent in from the start.
5. **Where this document lives: resolved.** Drive, `places/aweborn/`. Still open: who reviews it.
6. **Creator economy: resolved (Q8 a).** Creators earn mana from visitors, but it stays in-game: no cash-out. This keeps us clear of money-transmitter rules, payout fraud and private-benefit questions for a 501(c)(3). Revisit only with counsel.

## Sources (list prices, Oct 2026; verify before use)
- Meshy API: text-to-3D 20–35 credits per request (meshy.ai docs)
- Tripo API: 100 credits = $1; base generation 10–40 credits, textures +10–30, rigging 10–25 (tripo3d.ai)
- ElevenLabs Sound Effects API: ~$0.12 per generation
- F2P benchmarks: payer conversion 1.5–3.5% (casual/mid-core), subscriptions 12–18% of engaged players; monthly ARPPU $8–15 casual, $40–90 mid-core (AppsFlyer / GameAnalytics roundups)
