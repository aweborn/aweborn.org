# Game layer: changes to Privacy, Terms and RESEARCH.md, for legal review

**Date:** 2026-11-23. **Status: not reviewed by a lawyer or an IRB.** The pages are written to be shippable as they stand, but [Phase 10](../../phases/10-game-layer.md) ("Before slice 2") says: lawyer pass first, then recording ships in the same push as the pages.

**What changed in the product:** worlds can hold games. Every match is recorded for everyone in it, kept indefinitely, and watchable as a replay.

## Decisions behind the text (Alex, 2026-11-23, Phase 10 Decisions table)

| Key | Decision |
|-----|----------|
| Q1b | Hard rule: any match can be traced by replaying its telemetry. |
| Q10a | Record and replay every match, for everyone. Replays are linked to the character ("a character's assets") and kept forever. Publishing to social media is a later, separate design. |
| Q10b | A player who opts into 18+ content is automatically a research candidate: disclosed, no consent form. Others appear in research as anonymous stand-ins. Supersedes the 2026-11-20 separate research opt-in. A lawyer and the university partner's IRB confirm before publication. |
| Erasure (under Q10b) | The replay stays (it is also the other players'), the erased player becomes an anonymous stand-in, the research-ID link is deleted. |
| Q7 | NPC players are always labelled as AI in the world and in the record. A rule, never a language model, decides scores. |
| Q8 | The record notes when an NPC holds a dropped player's slot and when the player returns. |
| Q9 | Rewards are awe. No money or mana prizes. Limits against farming awe. |
| Q13 | Games (rules, arena, NPC roster) can be saved to the Library and reused, credited to their makers. |
| Q5b / slice 1 | The arena's footprint is a stage: only the creator and builders change it. |

## Every sentence added or changed

"New" means there was no text before. Wording is quoted from the pages; where a passage is long, the first and last words are given and the page has the rest.

### `public/privacy.html`

| # | Section | Before → after | Decision |
|---|---------|----------------|----------|
| P1 | Date | "Last updated: November 10, 2026" → "November 23, 2026" | standing rule |
| P2 | What we collect → Your progress | "…which creation finished, or another player's first visit…" → adds "which match you finished," | Q9 |
| P3 | same | New, after "We keep only those totals, not the path you flew.": "Matches are different: see “Games and matches” below." | Q10a (the old sentence would otherwise be false inside a match) |
| P4 | What we collect → Live presence | New, at the end: "None of this paragraph's time limits apply to what a match records (next)." | Q10a (the 14-day and 30-day limits there do not cover match records) |
| P5 | What we collect → **Games and matches** (new bullet, `#matches`) | New: "A world's makers can turn it into a game, and every match is recorded, for everyone who plays in it." Then the list of what the record holds (world; game version; who played with character name and random player ID; human or NPC; teams and how formed; position about ten times a second; events; result), "That is enough to play the whole match back.", "You are in a match record only if you join a match.", "We keep match records with no end date…" | Q1b, Q10a, Q7, Q8 |
| P6 | What we collect → **Replays can be watched by others** (new bullet, `#replays`) | New: who can watch live (the lobby), what a replay shows (character name, team, movements, score, which were NPCs), the character's list, the lobby's recent matches, "anyone who has a replay's link can watch it, whether or not they played or have saved a player", and "we don't take one down because one player asks". | Q10a, Q8 part 3 |
| P7 | What we collect → **NPC players** (new bullet) | New: "They are always labelled as AI in the world, in replays and in the match record…" | Q7 |
| P8 | What we collect → **Games in the Library** (new bullet) | New: saving publishes the game (rules, arena with what stands in it, NPC roster), shows makers' character names, "Every version of a game is kept, because a replay needs the version it was played on." | Q13, Q10a |
| P9 | How we use it | New bullet: "To run matches: referee them by the game's rules, show them to people watching, and keep their replays." | Q10a |
| P10 | Research → **How people play together** (new bullet, `#match-research`) | New: what is studied; "The copies we study carry research IDs, never player IDs or character names."; "Our analyses use a player's own trace only if that player has chosen to turn on 18+ content."; the stand-in sentence; "So turning on 18+ content also makes your match play research data. There is no separate research form, and we'll say this again where you make that choice."; "That choice isn't in the game yet; until it is, every player in our match research is an anonymous stand-in." | Q10b |
| P11 | Research → Before we record more | "(for example movement histories)" → "(for example how you move inside a world outside a match)" | Q10a (movement in matches is now recorded, so the old example was out of date) |
| P12 | Research → Publishing | New, at the end: "Before we publish any research that uses match records, a lawyer and our university partner's research ethics board review the approach described here. Replays are a separate thing: they are part of the game, and who can watch them is described under “Replays can be watched by others” above." | Q10b |
| P13 | How long we keep it | New bullet: "Match records and replays are kept with no end date. If you ask us to delete your player, the replays … stay … you become an anonymous stand-in … the link between your player and its research ID is deleted … Your movements, team and score in those matches remain, with nothing that says they were yours. People who already watched a replay, or who remember who played, may still know which player you were." | Q10a, erasure |
| P14 | How long we keep it | New bullet: "Every version of a world's game, and of a game saved to the Library, is kept for as long as replays that were played on it are kept." | Q10a, Q13 |
| P15 | Your choices and rights | New bullet: "Matches are optional. You can explore, build and watch without joining one, and only joining a match puts you in its record." | Q10a |
| P16 | Your choices and rights | After "…delete your player and everything linked to it." adds: "Replays of matches you played are the one exception: they stay, with you as an anonymous stand-in (see “How long we keep it”)." | erasure |

### `public/terms.html`

| # | Section | Before → after | Decision |
|---|---------|----------------|----------|
| T1 | Date | "November 10, 2026" → "November 23, 2026" | standing rule |
| T2 | **Games and matches** (new section, `#games`, before Community rules), bullet 1 | New: who can make a game; "Inside the arena, only the creator and builders can add, move, kick or remove things; this is the exception to “Who can change a world” above." | Q2, Q5b (already enforced since slice 1; Terms did not say it) |
| T3 | same, bullet 2 | New: "Every match is recorded and can be replayed." What is recorded, "kept with no end date", link to Privacy. | Q1b, Q10a |
| T4 | same, bullet 3 | New: "Others can watch." … "Don't join a match if you don't want that." | Q10a |
| T5 | same, bullet 4 | New: "Replays stay." Linked to the character; "it belongs to everyone who played in it"; erasure makes you a stand-in. | Q10a, erasure |
| T6 | same, bullet 5 | New: "NPCs are always labelled as AI, in the world and in the record. Scores and wins are decided by the game's rules, never by an AI language model." | Q7 |
| T7 | same, bullet 6 | New: "Finishing a match earns your character awe (experience). There are no money or mana prizes. We may limit how much awe matches give (for example each day, or for matches played only against NPCs)." | Q9 |
| T8 | same, bullet 7 | New: Library games are public, reusable, credited; "the versions of your game that matches ran on are kept with those replays even if you later change or remove the game." | Q13, Q10a |
| T9 | same, bullet 8 | New: "The community rules below apply in matches and in the games you make." | none (clarifies existing rules) |
| T10 | Research | After "…where you get a choice." adds four sentences: research uses a player's own match play only if they turned on 18+ content; others are stand-ins; "this is disclosed here and in the Privacy Policy, and there is no separate research form"; "That choice isn't in the game yet." | Q10b |

### `RESEARCH.md`

| # | Section | Before → after | Decision |
|---|---------|----------------|----------|
| R1 | Status line | "draft v0.1 (2026-10-13)…" → "draft v0.2 (2026-11-23: matches added … not yet reviewed by a lawyer or an IRB). v0.1…" | — |
| R2 | How the game serves the research | New bullet: "Games inside worlds." | Phase 10 goal |
| R3 | Data principles, rule 1 | "(updated 2026-10-13)" → "(first updated for research 2026-10-13; for match records 2026-11-23)" | standing rule |
| R4 | Data principles, rule 6 | Adds: "For match records, a lawyer and the partner's IRB confirm the approach below before anything is published." | Q10b |
| R5 | **Matches** (new section) | Eight numbered rules (recording, kept indefinitely and who can watch, the 18+ filter, research IDs, erasure, humans vs NPCs, awe, review before publication) and a "Not settled here" paragraph (18+ for all vs. an 18+ opt-in). | Q1b, Q7, Q9, Q10a, Q10b |
| R6 | Open questions | New bullet pointing here. | — |

## Where the pages and the decisions disagree (left open on purpose)

1. **"Opts into 18+" vs. "you must be 18 or older".** Terms ("Who can play"), Privacy ("Age") and RESEARCH.md rule 5 say everyone is an adult. The decision speaks of an 18+ *opt-in*, which is not built, and of Aweborn being "for everyone" (2026-11-20, still an open item). The new text does not decide it. It says the choice "isn't in the game yet" and that until then everyone in match research is a stand-in. **If Alex means match research to start before the opt-in exists, P10, T10 and R5 must change.**
2. **Research without an opt-in exists today for other data.** Privacy says everyone's AI-creation history and chat are studied (chat under the player ID, not a research ID). The 18+ filter was decided for the game layer only; those sections are unchanged. The policy now has two research bases side by side.
3. **"Keyed by a research ID, not the player ID".** True of the research copy (as written in P10). The match record itself, as specified in `shared/match.ts`, stores each human's player ID and character name, and anyone with the replay's link can fetch it. P5 and P6 say so.
4. **"Delete your player and everything linked to it"** and **"We study journeys, not individuals"** (Privacy) now have an exception and a strain, respectively: replays stay (P13, P16), and a match record is an individual's trace.
5. **RESEARCH.md rule 1** ("players are told in the game" before anything new is recorded) and Privacy "Changes": an in-game notice is needed when recording ships. Not part of these files.
6. **Terms, "What you create":** the licence "ends when the content is deleted". Game versions (rules, arena) are kept as long as replays are (T8, P14).
7. **`research.ts` → `forgetPlayer`** today deletes planner history and the research-ID row only. P13 and T5 are true only once it also rewrites match records (name and ID to a stand-in) and drops the replay from the character's list.

## Questions for the lawyer

1. **Indefinite retention vs. erasure.** Is turning a person into a stand-in (name and IDs removed; movement trace, team and score kept) enough for an erasure request under GDPR/UK GDPR art. 17 and the US state laws? Is "they also belong to the other players" a sound reason to keep the rest? Does "no end date" meet storage limitation, or do we need a stated period or review cycle? What about backups (90 days) and copies already downloaded?
2. **Replays show several people.** Anyone with a link can see every player's character name and movements. Is disclosure in Terms and Privacy enough, or does each player need a setting (hide my name in replays, lobby-only)? Does a character name count as personal data when it is a pseudonym the player chose? What should happen when one player in a replay objects?
3. **Is a stand-in anonymous?** A ten-times-a-second movement trace may be re-identifiable (play style, who else was there, time). May we call it "anonymous", or only "pseudonymous"/"de-identified"? Does this change what can be published as a data set?
4. **Behavioural data.** Does movement and team-play telemetry, kept indefinitely and used to study how people cooperate, amount to profiling, or become sensitive data in any jurisdiction (inferences about personality or psychology)? Is a data protection impact assessment needed?
5. **Lawful basis for research without a consent form.** The 18+ opt-in doubles as entry into research. Under GDPR, is that consent (then it is bundled and may not be "freely given" or "specific"), or should the basis be legitimate interests or the research provisions (art. 89)? In the US, is disclosure enough? Must leaving research be as easy as joining, and what happens to a player's past traces if they turn 18+ content off?
6. **IRB.** Does the university partner's IRB accept disclosure-only (a waiver of informed consent under the Common Rule, 45 CFR 46.116(f)) for identifiable-by-key gameplay data? Must review happen before *collection* rather than before *publication* for the data to be usable? Is recording for the game first and research second (secondary use) the right framing?
7. **Minors, if ever allowed.** Today everyone must be 18+, but nothing verifies age. If under-18s or under-13s are admitted later: COPPA (persistent identifiers, public replays), state age-appropriate design and minors' privacy laws, parental consent for research (45 CFR 46 subpart D), and whether records made before the change that turn out to be minors' must be purged.
8. **US state privacy laws.** Do any apply to a non-profit of this size (several exempt non-profits; Colorado, Oregon, Delaware, New Jersey, Maryland and Minnesota do not fully)? If so: notice at collection, the retention statement ("no end date"), deletion exceptions, and whether public replays are a "sale" or "sharing" (we think not).
9. **Creators' content.** The licence in Terms ends on deletion, but game versions are kept as long as their replays. Does the licence clause need an explicit exception? Is the Library credit wording enough for reuse and derived versions?
10. **Third parties in a replay link.** A replay link works for people who never accepted the Terms. Any duty toward the players shown, or toward viewers?
11. **NPC labelling.** Does "always labelled as AI" satisfy the bot-disclosure laws that may apply (for example California's), now and when NPCs later talk through a language model?
12. **Later: Social Publication.** Not described anywhere on the pages. Confirm nothing in the new text could be read as permission to publish replays outside Aweborn.

## Addendum: the 18+ switch is built (2026-11-23, later the same day)

**Status: not reviewed by a lawyer or an IRB.** The switch is on the branch `age-18plus-opt-in`, not deployed. It ships in the same push as these pages, after the lawyer pass.

**What changed in the product:** a saved player can turn on *18+ content* in the player panel. The first time, they enter a date of birth; the server checks it is 18 or older and does not store it. Being behind the switch makes the player's match play research data (Q10b). No 18+ content exists yet.

**What is stored** (table `age_door`, one row per account): that the date passed and when, whether the switch is on, when it last changed. Each match also records, per human player, whether they were behind the switch when it began (`match_players.research_ok`). An under-18 date stores nothing; the account is held from retrying for 24 hours in the server's memory.

### Every sentence added or changed

| # | Page, section | Before → after |
|---|---------------|----------------|
| D1 | Privacy → What we collect → **The 18+ switch (optional)** (new bullet, `#door`) | New: what is asked, "We check the date and don't keep it.", what is kept, the under-18 case, "The date is your own statement: we don't verify it.", "No 18+ worlds are open yet, so today the switch shows you nothing new. It does one thing now: it makes how you play in matches part of our research". |
| D2 | Privacy → Research → How people play together (P10) | "…and we'll say this again where you make that choice. That choice isn't in the game yet; until it is, every player in our match research is an anonymous stand-in." → "…and we say this again where you make that choice: at the 18+ switch in your player panel. It covers matches that begin while your switch is on. If you turn the switch off, we stop using your traces, including those from matches you played while it was on… Matches played before you turned it on are never used as yours." |
| D3 | Privacy → How long we keep it | New bullet: "Your 18+ choice (that your age was checked, and whether the switch is on) is kept until you ask us to delete your player. Your date of birth is never kept." |
| D4 | Privacy → Your choices and rights | New bullet: "The 18+ switch is optional, and you can turn it off again at any time in the player panel. That also takes your match play out of our research." |
| D5 | Terms → Research (T10) | "That choice isn't in the game yet." → "You make that choice with the 18+ switch in your player panel. It asks for your date of birth: give your real one. You can turn the switch off again at any time." |
| D6 | RESEARCH.md → Matches, rule 3 | Adds how it is built and the two rules a research copy follows (behind the door when the match began, and still). |
| D7 | RESEARCH.md → "Not settled here" | Rewritten: the switch exists; the date is self-declared; under-18s remain an open decision. |

**In the game, at the switch, before the choice:** "18+ worlds aren't open yet. You'll be ready when they are." · "Turning this on makes how you play in matches part of Aweborn's research, under a random research ID, never your name. There's no separate research form. How research works [link to Privacy `#match-research`]" · "You can turn it off here any time. Your matches then stop counting for research." · "We check the date and don't keep it."

### Where the pages and the product now disagree

1. **Disagreement 1 above is sharper.** Terms and Privacy still say every player must be 18+, and the game now asks some players to state it. A player who enters an under-18 date is refused the switch and nothing else happens: the account keeps playing, and we store nothing about the date. Alex has not decided whether under-18s may play (2026-11-20, open).
2. **D3 and erasure.** No route deletes a player today (a known gap). `forgetDoor(accountId)` exists for it; until it is called, D3 is true only when a person does the deletion by hand.
3. **"We don't verify it" vs. Phase 07 decision 3.** A real age check by location is a launch requirement for 18+ *content*. The switch is built ahead of the content; the check is not built.

### More questions for the lawyer

13. **A switch named "18+ content" whose only present effect is research.** The in-game text and D1 say so plainly. Is that enough, or is the name itself misleading until 18+ worlds exist? (This is question 5's bundling concern, now concrete.)
14. **Self-declared age.** Is a date of birth with no verification an acceptable basis for (a) treating a player as an adult research subject, and (b) later showing 18+ content where no law demands a real check?
15. **An under-18 date.** Having been told a date under 18 by an account whose Terms require 18+, must we do anything (block the account, delete its data, delete its match records)? We keep no record of it by design; does that choice hold up, or does it look like avoiding knowledge?
16. **Asking for a date of birth and not storing it.** Is "checked and dropped" enough to stay clear of rules about collecting birth dates? Should the fact that someone passed be treated as personal data of any special kind?
17. **Turning the switch off.** We take the player's earlier matches out of research as well. Is that required, merely cautious, or does it conflict with research already published?

