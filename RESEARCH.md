# Aweborn Research: why the game exists

> **Status:** draft v0.2 (2026-11-23: matches added, see "Matches" below; not yet reviewed by a lawyer or an IRB). v0.1 (2026-10-13) was written with Alex in the Phase 05 design session. ROADMAP is the design bible for the *game*; this file is the *why*.

## Origin: MatchRank (2023)

Aweborn began as **MatchRank**, an idea Alex wrote about in a 2023 graduate-school statement of purpose:

- About half of U.S. employees are disengaged, feel ill-cared for and lack direction (Gallup, 2022), and it got worse with the pandemic and remote work.
- Most of us need a **sense of belonging** to be engaged and do our best work.
- That may be fixed **systematically**: match every person with at least three people: an expert aligned individual (**mentor**), a novice aligned individual (**mentee**) and, most importantly, an aligned **peer**.
- MatchRank: methods that take an organization as input and output matched teams of people who can build **earned, secure relationships** with each other. It draws on social computing (Bernstein) and team organization (Valentine) research, and on years of deliberate pair programming.

**Today MatchRank is called Aweborn.** The mission: merge psychological-safety, personality and team-dynamics research to systematically build great teams, so a working day feels like a regular good day.

## Why a game

Surveys measure what people *say* about themselves. A shared creative universe shows what people *do* together: who they explore with, how they co-create, how they recover when a creation fails, who keeps coming back to whom.

What the research already suggests, and what it means for us:

| Finding | Implication for Aweborn |
|---|---|
| Who is on a team matters less than **how the team works together**; psychological safety is the strongest factor (Google, Project Aristotle; Edmondson) | Safety is a property of a team that grows over time, not a trait of one person. We need to observe teams, not just score individuals |
| Groups have a measurable **collective intelligence**, tied to social sensitivity and evenly shared turn-taking (Woolley et al., 2010) | Those are things we can observe in co-creation |
| Personality traits predict team outcomes only modestly | Personality is one signal, never the whole match |
| Rotating people across teams can find better combinations (Salehi & Bernstein, *Hive*, 2018) | **Match → observe → re-match** beats predicting the perfect team once |
| Game behavior carries real signal about players (stealth assessment, Shute; Yee et al.) | Play can be measured without interrupting it |

**Working hypothesis:** teams formed by *matching, watching real collaboration and re-matching* will show more psychological safety and better shared outcomes than teams formed by profiles alone. Aweborn is the place to test that, at scale, in play.

## How the game serves the research

- **Manifesting together.** Creating with others is the core loop; it generates the collaboration traces we study.
- **Scaffolded levels.** Players climb through the Gen AI studio tools step by step, so journeys are comparable across players.
- **The shared universe.** No one owns mana; everyone's curiosity and generosity grow reality for everyone. The game rewards contributing to the commons.
- **Games inside worlds.** Players turn a world into a game (boundaries, rules, a goal, teams, a lobby, NPC players). Every rule, team assignment and outcome is data, so each match is a well-described trial of *match → observe → re-match*.

## Data principles (confirmed by Alex, 2026-10-13)

1. **Disclosed, no consent form.** The [Privacy Policy](https://aweborn.org/privacy.html) says plainly what gameplay we record and why (first updated for research 2026-10-13; for match records 2026-11-23). Before recording anything new (e.g. movement histories, co-creation traces), the policy is updated first and players are told in the game.
2. **Pseudonymous and aggregated.** Research uses gameplay traces keyed by random IDs, separate from account data (email, sign-in). We analyze patterns across players and journeys, not individuals.
3. **Minimal.** Only gameplay events. No content of private messages, no data from outside the game, no selling or ad use, ever.
4. **Explicit opt-in when it becomes about *you*.** Anything that profiles an identified person (a personality read-out, being matched into a real team at work) is opt-in and revocable.
5. **Adults.** Aweborn is 18+ (Terms), which keeps research data clear of COPPA.
6. **Publishing.** When results are published with a university partner, that partner's IRB reviews the protocol (de-identified gameplay data is usually exempt or quick). For match records, a lawyer and the partner's IRB confirm the approach below before anything is published.

## Matches (decided by Alex, 2026-11-23; [Phase 10](phases/10-game-layer.md) Q1b, Q7, Q10a, Q10b)

1. **Every match is recorded, for everyone who plays in it,** and can be replayed: the game version (rules, arena, NPC roster), who played, the teams and how they were formed, each player's position about ten times a second, the events (zone entries, scores, an NPC holding a dropped player's slot and the return) and the result. The hard rule: any match can be traced by replaying its telemetry.
2. **Kept indefinitely.** A replay is linked to the character that played (*"a character's assets"*). People in the world's lobby can open its recent matches, and anyone with a replay's link can watch it. Publishing replays outside Aweborn is not part of this; it gets its own design later.
3. **The 18+ opt-in is the research filter.** A player who opts into 18+ content is automatically a research candidate: disclosed in Privacy and Terms and at the 18+ door, no separate consent form (rule 1 above). Analyses use the traces of players who opted in. Players who have not appear in research only as anonymous stand-ins. This replaces the 2026-11-20 idea of a separate, revocable research opt-in.
4. **Research IDs.** Research copies of match records are keyed by research ID, not player ID or character name (rule 2 above).
5. **Erasure.** When a player asks to be forgotten, the replay stays (it also belongs to the other players), the player becomes an anonymous stand-in in it, and the link to their research ID is removed.
6. **Humans and NPCs are always told apart.** Each participant is recorded as human or NPC, with which NPC, behavior and level; NPCs are labelled as AI in the world. Scores and wins come from rules, never from a language model, so outcomes are reproducible.
7. **Rewards are awe** for finishing a match. No money or mana prizes, so nobody plays for a payout.
8. **Before publication:** a lawyer and the university partner's IRB confirm all of the above.

Not settled here: today Terms and rule 5 above say every player is 18+, and the 18+ opt-in is not built. Until it is, no player has opted in, so match research has only anonymous stand-ins. Whether Aweborn opens to under-18s is a separate open decision ([phases/README.md](phases/README.md), "Age restriction hardening").

## Open questions

- Which signals actually indicate a good match: co-creation frequency, turn-taking in shared builds, return visits, recovery after failures?
- How do we validate in-game matches against real workplace outcomes, and with which partner organizations?
- University partner (UMD?) for publishing.
- Matches: is "disclosed, no consent form" enough for traces that are kept indefinitely and tied to a research ID? Does a stand-in's movement trace count as de-identified? (For the lawyer and the IRB: [docs/legal/2026-11-game-layer-pages.md](docs/legal/2026-11-game-layer-pages.md).)

## References

- Harter, J. "Is quiet quitting real?" Gallup, 2022.
- Allen, K.-A. et al. "Belonging: A review of conceptual issues, an integrative framework, and directions for future research." *Australian Journal of Psychology* 73(1), 2021.
- Edmondson, A. "Psychological safety and learning behavior in work teams." *Administrative Science Quarterly* 44(2), 1999.
- Woolley, A. W. et al. "Evidence for a collective intelligence factor in the performance of human groups." *Science* 330, 2010.
- Salehi, N. & Bernstein, M. S. "Hive: Collective design through network rotation." *CSCW*, 2018.
- Shute, V. J. "Stealth assessment in computer-based games to support learning." 2011.
- Hannay, J. E. et al. "The effectiveness of pair programming: A meta-analysis." *Information and Software Technology* 51(7), 2009.
