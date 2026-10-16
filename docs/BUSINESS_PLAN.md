# Aweborn: Economy & Business Plan (DRAFT v0.4, 2026-10-14)

> [!NOTE]
> **Open by design.** This is Aweborn's real business plan, published on purpose. Nothing about how Aweborn is run is meant to be hidden. If you see problematic language, a bad assumption or a wrong number in this plan or anywhere in this repository, [open an issue](https://github.com/aweborn/aweborn.org/issues) and we'll answer it in public. Borrow anything you like to start your own venture (see the [license](#license)).

> [!IMPORTANT]
> A draft. Every number is an assumption to check. Provider prices are list prices as of Oct 2026. Not legal or tax advice: the questions in §9 are for an attorney and a CPA.

> **v0.4 replaces the v0.3 mana-sales model** (\$1 \= 1,000 mana, M \= 4 markup, Curiosity Budget, personal reserves, Resonance). All of that is retired; v0.3 is in this file's git history. The game-side design lives in [`phases/05-mana-economy.md`](../phases/05-mana-economy.md) and in the [ROADMAP](../ROADMAP.md)'s mana section.

## 1\. The one-paragraph pitch

**Aweborn is a non-profit, incorporated with 501(c)(3) status.** Its mission is research into making work humane: understanding people's personalities and matching them into teams that work, so a working day feels like a regular good day instead of hell. The game is how the mission meets people, and gifts are how it funds itself.

Aweborn is a shared universe where curiosity becomes creative energy. Players explore for free. What they find sparks **awe**, which earns experience and unlocks abilities. **Dreaming is free.** **Manifesting** (making things real with AI: meshes, terrain, sounds, whole worlds) draws on **mana**, the universe's shared creative energy. **Nobody buys or owns mana.** Mana is real compute, and it is funded by **donations**: half of every gift becomes mana for everyone. **NFC cards** are the universe's portals: tap one and you're inside that world, even at the far edge of the cosmos. They're how Aweborn moves people: into the game, across it, and into the research.

## 2\. What the design guarantees (and what it can't)

No plan can guarantee the mission gets funded. This one guarantees that **the game can't spend money we don't have**:

1. **Compute spend ≤ the creative share.** All money in becomes mana in the pool (the treasury, live); players draw only from the creative share, α \= 0.5 of unrestricted income. Manifesting draws exactly its real cost. Neither number can go negative.  
2. **Throttling, not debt.** When the pool runs low the world slows ("The world must be replenished…"). It never borrows.  
3. **No sales, no markup.** Every mana drawn is one cent of real compute. Nothing is sold, so nobody is overcharged and there is no "pay to win".  
4. **Losses are limited to fixed costs** (people \+ baseline infra), drawn from the non-creative part of the pool (1 − α of income, plus restricted grants).  
5. **The gap to a paid team is a tracked number** (§7).

## 3\. Mana: one cent of compute

**K \= 100 → 1 mana \= \$0.01 of real compute.** Formula: `mana = ceil(direct_cost_usd × 100)`. No markup. Placing, moving and arranging objects is free.

| Act | Direct cost (est.) | Mana |
| :---- | :---- | :---- |
| Place / move / arrange objects | \~\$0 | free |
| Image / texture | \~\$0.04 | \~4 |
| Sound effect (ElevenLabs list: \$0.12/gen) | \~\$0.13 | \~13 |
| Music loop 30–60 s | \~\$0.30 | \~30 |
| Textured object mesh (Tripo list: \$0.20–0.70) | \~\$0.40 | \~40 |
| Terrain patch (AI) | \~\$0.50 | \~50 |
| Rigged character mesh (Meshy/Tripo \+ rigging) | \~\$0.90 | \~90 |
| **Manifest a brand-new world** (4 terrain, 10 objects, 2 characters, 5 sounds, skybox, music) | \~\$8.80 | **\~880** |


> [!NOTE]
> Costs are set by *output* (a mesh, a sound, a world), not by provider. Change providers and only the cost column moves.

### The pool is the treasury (decided 2026-10-14)

**All money entering Aweborn counts** at K: gifts, card sales, grants, the founding gift. **Every dollar out is a categorized draw**: creations, servers & infra, cards (production \+ shipping), people, research, fundraising. Mana is therefore a **live picture of how much money Aweborn has**, which is radical transparency for a non-profit.

- Example: \$10 gift → \~\$9.41 after Stripe (2.9% \+ 30¢) → **\~941 mana into the pool**, of which **\~470 is creative share**.  
- **Creative share** \= α of unrestricted income (card sales after their own production \+ shipping; restricted grants add nothing). Players draw only from it; salaries and servers draw only from the rest.  
- All money in also raises the **high-water line**, which sets the Living Frontier's size (radius ∝ ∛highWater) and never falls. A golden wave shows each gift in the game.  
- Display the pool smoothed (e.g. 30-day average) so payday reads as a calm breath, not a crash.

## 4\. Pool, flow and fairness

- **One universal pool (the treasury)** with a **creative share** inside it. Money fills both; manifesting drains the creative share at real cost.  
- **Global flow:** `G = min(C, max(C / τ, p_solo))` on the creative share `C`, with **τ \= 30 days**. In plain words: the creative share can shrink by at most about 1/30 of itself per day, so a burst can't drain it and a dry spell drains it gently. τ \= 30 was chosen by simulation against τ \= 90 (at 90, gifts piled up unused while players were throttled almost daily).  
- **Max-min fair split:** `N` \= players active in the last 30 minutes. Each gets an equal share of `G`, capped at their personal cap `p_i = base(level) × solar` (solar ±10%). Unused shares are redistributed to players who want more. One player alone gets their full personal cap.  
- **Admission:** a request reserves its estimate, then settles the actual cost. Failures draw nothing.  
- **Seed grant:** the pool needs a starting balance. **Alex's founding gift: \$1,000** (5× the simulation's \$200 floor) → **100,000 mana in the pool, 50,000 of it creative share**.

## 5\. Where a gift goes: 50 / 20 / 30

| Share | Use |
| :---- | :---- |
| **50% mana (α)** | Compute for every creation in the game |
| **20% research** | The mission: trust and teamwork research |
| **30% people & operations** | Servers, safety, support, fundraising; holds the 3-month operating reserve |


Rationale (all on the public page `aweborn.org/giving.html`):

- Programs (mana \+ research) \= 70% ≥ the BBB Wise Giving Alliance's 65% program standard; fundraising stays within its 35% cap. [https\://give.org/charity-reviews/bbb-standards-for-charity-accountability](https://give.org/charity-reviews/bbb-standards-for-charity-accountability)  
- Don't starve overhead: Gregory & Howard, "The Nonprofit Starvation Cycle", SSIR 2009\. [https\://ssir.org/articles/entry/the\_nonprofit\_starvation\_cycle](https://ssir.org/articles/entry/the_nonprofit_starvation_cycle)  
- Overhead aversion: Gneezy, Keenan & Gneezy, Science 2014\. [https\://doi.org/10.1126/science.1253932](https://doi.org/10.1126/science.1253932) → if a founding grant ever covers operations, raise α for everyone else.  
- Evaluability bias: Caviola et al., JDM 2014\. [https\://www\.ncbi.nlm.nih.gov/pmc/articles/PMC4179876/](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4179876/) → show impact in-game, not just a ratio.

## 6\. Awe, levels and what money can't buy

- **Awe → XP and reach, never mana.** Awe also nudges the high-water line (free: it's only the Frontier's size).  
- **Level** \= mana channeled into creations that settle and stay (concave) \+ breadth of skills; reactions and awe add XP.  
- **The ladder ends with warp.** Move → steer → drive/neutral → enter a world → place objects → the maker tutorials → master your local space and explore enough of the universe → **warp**.  
- **Donors get no gameplay advantage.** The only perk is an opt-in name on the golden wave. Card taps and `/w/` links are never gated.

## 7\. Revenue & scenarios (monthly, baseline assumptions)

| Stream | Model | Notes |
| :---- | :---- | :---- |
| **Donations** (core) | One-off and recurring gifts, split 50/20/30 | Pure gifts: no goods or services in return → deductible |
| **Alex's founding gift** | **\$1,000**, seeds the pool | Also: \~\$1K of cloud bills already paid personally (§9) |
| **NFC cards** (second core) | Single-world cards \~\$8–10: favorite worlds, far-away worlds, creators' own worlds; curated sets; event runs | **Mission, not merchandise:** cards bring people in (§7b). \~\$2 production before art/packaging/shipping |
| **Organizations** | Events, schools and companies sponsor worlds \+ card runs | Qualified sponsorship (§9) |
| **Grants** | Arts, education, workplace/organizational research | Main path to paying people |
| **Impact funding** | Program-related investments, recoverable grants, research partnerships | The non-profit version of "investors": no equity |
| **Research (later)** | Team matching from opt-in personality signals | Not in base case. Needs explicit consent |


**Assumptions (to verify):** 2% of MAU donate, \$15 average per donor per month, \~95% net after fees, 20% of MAU create and use \~\$0.75/month of compute, infra ≈ \$0.03/MAU \+ \$100 base.

| MAU | Net gifts | Mana (50%) | Compute demand | Research (20%) | Ops (30%) | Infra |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| 1,000 | \~\$285 | \~\$143 | \~\$150 | \~\$57 | \~\$86 | \~\$130 |
| 10,000 | \~\$2,850 | \~\$1,425 | \~\$1,500 | \~\$570 | \~\$855 | \~\$400 |
| 100,000 | \~\$28,500 | \~\$14,250 | \~\$15,000 | \~\$5,700 | \~\$8,550 | \~\$3,100 |


Reading it:

- **Mana roughly matches demand** at these assumptions; the small gap shows up as gentle throttling at peaks, never as a bill.  
- **At \~1k MAU the ops share doesn't cover infra.** Alex's founding gift and early grants bridge it.  
- **A \$20k/month team** would need \~\$66.7k net/month from the 30% share alone (\~234k MAU at these assumptions). **Grants and sponsorships are how people get paid**, not gifts alone.

## 7b. Cards: the second engine

**Role (decided 2026-10-14): shortcut and souvenir, never the only door.** The cosmos is vast; a card is the fastest way to any world, and a keepsake you can hold and give. Every world stays reachable by flying or, once earned, by warp, so money never buys access.

**Who buys:** players who want their favorite world; explorers who want a jump to far-away worlds; **creators who want cards of their own worlds to hand out**, and every card handed out is a new player arriving inside a world.

**Per card (assumptions to verify):** price \$9 − production \~\$2 − Stripe \~\$0.56 − packaging \+ shipping **\~\$1–2 (no quote yet)** ≈ **\$4.50–5.50 surplus (call it \$5)**.

**Scenario:** 5% of MAU buy one card per month (assumption), \$5 surplus each.

| MAU | Cards / month | Card surplus | Gifts (net) | Total |
| :---- | :---- | :---- | :---- | :---- |
| 1,000 | 50 | \~\$250 | \~\$285 | \~\$535 |
| 10,000 | 500 | \~\$2,500 | \~\$2,850 | \~\$5,350 |
| 100,000 | 5,000 | \~\$25,000 | \~\$28,500 | \~\$53,500 |


**What it does to the team gap** (\$20k/month team paid from the operations side; infra not subtracted, same as §7):

| Case | Team covered at about |
| :---- | :---- |
| **With cards (decided):** all card money enters the pool; α of the surplus becomes creative share, the rest is available for people \+ operations | **\~125k MAU** |
| (no cards, gifts only, for comparison) | \~234k MAU |


Cards about halve the distance to a paid team. If that's still too far, the board can lower α for card surplus specifically (at α \= 0 for cards: \~60k MAU) without touching the gift split.

## 8\. Costs

COGS: AI APIs (paid only from the mana share), storage/CDN for generated assets, moderation, card fees. Infrastructure today: one Lightsail VPS \+ AWS (about \$50–100/month; total cloud spend to date ≈ \$1K, paid by Alex). Later: support, people, research.

## 9\. Open questions for the attorney / CPA

Most of these are **tax positions**: how Aweborn believes a kind of income should be treated, to be confirmed by professionals. The biggest one is card income (2): if card sales count as *related* to the mission, they are tax-exempt like gifts; if they count as *unrelated business income*, Aweborn would owe corporate income tax (UBIT, 21%) on the card surplus and file Form 990-T.

1. **Donations: simpler now.** No mana is sold, so the v0.3 UBIT worry about game sales mostly goes away. Confirm the in-game thank-you (opt-in name on the wave) is insubstantial.  
2. **NFC cards are mission-related.** Alex's position: cards exist to bring people into the game and its research, so card income should be **substantially related** to the exempt purpose (IRC 513(a)) and not unrelated business income. A precedent to check: Rev. Rul. 73-104 (a museum's greeting cards of its own artworks held substantially related). Separately, for the *buyer* a card is still goods received: only the amount above fair market value is deductible, and payments over \$75 need a written disclosure.  
3. **Corporate sponsors:** structure as **qualified sponsorship payments** (IRC 513(i)): acknowledgment, no advertising of their products.  
4. **Alex's \~\$1K of cloud bills:** record as an in-kind contribution or reimburse? Same question for the founding gift and for future personally paid costs.  
5. **The 50/20/30 split is public.** Have the board adopt it formally and review it yearly, as the giving page promises.  
6. **Research and privacy:** personality modelling needs separate, explicit, revocable opt-in, probably IRB review with academic partners.  
7. **Who reviews this plan.**

## Sources (list prices Oct 2026; verify before use)

- Meshy API: text-to-3D 20–35 credits per request (meshy.ai docs)  
- Tripo API: 100 credits \= \$1; base generation 10–40 credits, textures \+10–30, rigging 10–25 (tripo3d.ai)  
- ElevenLabs Sound Effects API: \~\$0.12 per generation  
- Stripe US card pricing: 2.9% \+ 30¢  
- The four split references in §5

## License

This plan is licensed under [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/): copy, adapt and use it for anything, including your own business, as long as you credit Aweborn. See [`docs/LICENSE`](./LICENSE).