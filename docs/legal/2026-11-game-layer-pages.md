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

## Addendum: the 18+ switch is built (2026-11-23; made a plain toggle 2026-11-24)

**Status: not reviewed by a lawyer or an IRB.** The switch is on the branch `age-18plus-opt-in`, not deployed. It ships in the same push as these pages, after the lawyer pass.

**What changed in the product:** a saved player can turn on *18+ content* in the player panel. It is a toggle: no date of birth and no other entry (Alex, 2026-11-24). Turning it on is the player's statement that they are 18 or older, and it makes the player's match play research data (Q10b).

**What is stored** (table `age_door`, one row per account): whether the switch is on and when it last changed. Each match also records, per human player, whether they were behind the switch when it began (`match_players.research_ok`).

**Decisions behind it (Alex, 2026-11-24, [Phase 07](../../phases/07-genai-creation.md) "Changed 2026-11-24"):** Aweborn is for everyone, with 18+ content kept in veiled 18+ worlds; the door is a toggle; a real age check only in the states and countries whose law requires one; a world is 18+ or everyone from creation and never switches.

### Every sentence added or changed

| # | Page, section | Before → after |
|---|---------------|----------------|
| D1 | Privacy → What we collect → **The 18+ switch (optional)** (new bullet, `#door`) | New: "A saved player can turn on 18+ content in the player panel. Turning it on is your statement that you are 18 or older. We keep whether the switch is on and when it last changed. Turning it on also makes how you play in matches part of our research". |
| D2 | Privacy → Research → How people play together (P10) | "…and we'll say this again where you make that choice. That choice isn't in the game yet; until it is, every player in our match research is an anonymous stand-in." → "…and we say this again where you make that choice: at the 18+ switch in your player panel. It covers matches that begin while your switch is on. If you turn the switch off, we stop using your traces, including those from matches you played while it was on… Matches played before you turned it on are never used as yours." |
| D3 | Privacy → How long we keep it | New bullet: "Your 18+ choice (whether the switch is on, and when it last changed) is kept until you ask us to delete your player." |
| D4 | Privacy → Your choices and rights | New bullet: "The 18+ switch is optional, and you can turn it off again at any time in the player panel. That also takes your match play out of our research." |
| D5 | Terms → Research (T10) | "That choice isn't in the game yet." → "You make that choice with the 18+ switch in your player panel. Turning it on says that you are 18 or older. You can turn it off again at any time." |
| D6 | RESEARCH.md → Matches, rule 3 | Adds how it is built and the two rules a research copy follows (behind the door when the match began, and still). |
| D7 | RESEARCH.md → "Not settled here" | Rewritten: Aweborn is for everyone with 18+ in veiled worlds; rule 5 and the Terms change with a lawyer. |

**In the game, at the switch:** "18+ content · for players 18 or older" and, beside the switch before it is tapped, "Turning this on also makes how you play in matches part of Aweborn's research, under a random research ID, never your name. How research works [link to Privacy `#match-research`]".

### Where the pages and the decisions now disagree

1. **"For everyone" vs. "you must be 18 or older".** Alex decided on 2026-11-24 that Aweborn is for everyone. Terms ("Who can play"), Privacy ("Age") and RESEARCH.md rule 5 still say every player is 18+. They are left as they are until the lawyer has answered question 7 above, because opening to under-18s and under-13s is where COPPA and the rules on research with minors begin, and today everyone's chat and AI-creation history is studied with no opt-in.
2. **D3 and erasure.** No route deletes a player today (a known gap). `forgetDoor(accountId)` exists for it; until it is called, D3 is true only when a person does the deletion by hand.
3. **The age check where the law requires one is not built.** The toggle is the same everywhere today. Before 18+ content is shown in a place whose law demands a real check, either the check or a block for that place has to exist.

### More questions for the lawyer

13. **A toggle as the statement of age.** Is tapping a switch labelled "18+ content · for players 18 or older" an acceptable basis for (a) treating a player as an adult research subject, and (b) showing 18+ content where no law demands a real check?
14. **Which places need the real check,** and may 18+ content simply be unavailable there until a vendor is chosen?
15. **Turning the switch off.** We take the player's earlier matches out of research as well. Is that required, merely cautious, or does it conflict with research already published?
16. **For everyone.** What must be true before the Terms stop saying 18+: a minimum age (13?), parental consent below it, research limited to players behind the 18+ switch for *all* data and not only matches, minds (companion-chat rules for minors)?

## Addendum 2: 18+ worlds (2026-11-24)

**Status: not reviewed by a lawyer.** Same branch, not deployed.

**What changed in the product:** a world is for everyone or 18+, chosen by its maker when it is made and never changed. Only players with the 18+ switch on can make, see into, enter or build in an 18+ world; everyone else sees it veiled, with no name. **What may be made is the same in every world**: the checks that refuse sexual, hateful or gory requests still run inside 18+ worlds. That changes later, with its own review.

| # | Page, section | Text |
|---|---------------|------|
| W1 | Terms → What you create → **18+ worlds** (new bullet, `#adult-worlds`) | "A world is for everyone or 18+. Its maker chooses when the world is made, and the choice can't be changed afterwards. A world planted inside an 18+ world is 18+ too. Only players who have turned on 18+ content can make an 18+ world, see into it, enter it or build in it; to everyone else it appears veiled, with no name. We don't make trading cards of 18+ worlds, and their games and minds don't go into the shared Library. Turning 18+ content on says that you are 18 or older; don't turn it on if you aren't. The community rules below apply in 18+ worlds as they do everywhere." |
| W2 | Terms → Trading cards → Ordering cards | adds "(not of an 18+ world)" |
| W3 | Privacy → The 18+ switch | adds "With it on you can see into, enter and make 18+ worlds; with it off they appear veiled, with no name, and we don't keep copies of them on your device." |
| W4 | Privacy → What we collect → **18+ worlds** (new bullet) | "When a world is made as an 18+ world, we record that with the world, permanently. Its name is shown only to players who have turned on 18+ content; everyone else, and anyone who follows a link to it, sees "18+ world"." |

### Where the pages and the product disagree

4. **W1 says "the community rules apply in 18+ worlds as they do everywhere", and the Terms still say "Don't ask for anything sexual, hateful or gory".** Both are true of the product today. When the rater replaces the all-ages refusals inside 18+ worlds, "Making things with AI" and "Community rules" change in that push.

### More questions for the lawyer

17. **An 18+ label on a space whose content rules are the same as everywhere.** Any issue with offering the label before the content rules differ? Does the label itself trigger any of the age-verification laws in question 14?
18. **Chat inside 18+ worlds** is between players behind a self-declared switch, with the same word filter as everywhere. Anything further needed before the rules inside differ?


## Addendum 3: deleting your player (2026-11-24)

**Status: not reviewed by a lawyer.** Same branch, not deployed.

> **For the lawyer, first: this narrows what "delete" means.** Until this change the Privacy page promised that deleting a player deletes their planner history and our research copy of their chat. Alex decided on 2026-11-24 that both are **kept and detached** instead: every entry stays as written (so a world's creation history and chat have no gaps), and the player ID, account ID and character name on it are replaced by a stand-in that can't be linked back. The text itself is untouched, so it can identify its author by what it says. E2, E3, E4, E7 and E8 below rewrite the sentences that promised deletion. People who typed things under the old promise are affected: see question 24.

**What changed in the product:** a saved player can delete their player themselves (player panel → "Delete my player…"). "Player" means the whole account: every character on it. The step says what is destroyed and what stays before anything happens, needs a typed word, and needs a sign-in on that device in the last 5 minutes (the same "Confirm it's you" as changing how you sign in). Until now deletion was by e-mail only and nothing in the code did it (disagreement 2 above is closed by this). The decisions per table and document are in `server/sync-service/src/erase-player.ts` (header) and its test.

| # | Page, section | Before → after |
|---|---------------|----------------|
| E1 | Privacy and Terms → Date | "November 23, 2026" → "November 24, 2026" (the 18+ addenda above had not moved it) |
| E2 | Privacy → How long we keep it → history of what you made with AI | "…is kept for research until you ask us to delete it with your player. Then we delete your planner history and the link between your player and its research ID. Our archive of individual AI requests is labelled with the research ID, not your player ID, but until we finish a way to delete it too, it can still be matched to your player through our private accounting records." → "…is kept for research with no end date. If you delete your player, your planner history stays, with your player ID replaced by a random stand-in (a different one in each world), and we delete the link between your player and its research ID. Our archive of individual AI requests stays: it is labelled with the research ID, not your player ID. When your player is deleted we also take your player ID off the private records that could connect the two (our accounting of what each request cost, and our list of creation jobs), so once our backups have expired the archive can no longer be matched to your player through our records. What you typed in a request stays in the archive as you wrote it." **Narrows deletion.** |
| E3 | Privacy → How long we keep it → chat | "Our permanent research copy of chat is kept until you ask us to delete it with your player." → "Our permanent research copy of chat is kept with no end date. If you delete your player, your messages stay in it and in the world's visible chat, as you wrote them, but your player ID is taken off them: they appear as from “A former player”." **Narrows deletion.** |
| E4 | Privacy → What we collect → Planner conversations are public | "If you ask us to delete your player, your planner history is deleted, so it leaves the story stone too." → "If you delete your player, what you said to the planner stays at the story stone, as written, under the same “Maker” number; the record of which player it came from is replaced by a random stand-in that can't be linked back to you (see “Deleting your player”)." **Narrows deletion.** |
| E5 | Privacy → Your choices and rights | The one bullet "You can ask us for a copy of your information, to correct it, or to delete your player and everything linked to it. Replays of matches you played are the one exception… Email us (below) and we'll respond within 30 days. Deleted data leaves our backups within 90 days." is now two. First: "You can ask us for a copy of your information or to correct it: email us (below) and we'll respond within 30 days." |
| E6 | same → **Deleting your player** (new bullet, `#delete-your-player`) | New: how (the panel, confirm it's you, a typed word, at once, can't be undone; unsaved players e-mail us, 30 days; backups 90 days), then five lists: **what is deleted** (sign-in methods and sessions, every character and its name, World Index, progress, 18+ choice, asks to build, mutes, what minds remember, reports about you, stopped requests, the private Library trash); **what you wrote stays, without your name** (chat and planner conversations kept as written; "The words themselves are not changed, so if what you wrote says who you are, it still will."); **what stays, with your player taken out of it, because other people use it** (worlds you created, "afterwards a world has no creator; its builders keep their rights, and nobody else gains any", things you placed, Library creations, minds and games, replays as a stand-in, reports you made without your ID or note); **what we keep because the law requires it** (donation and card order records and the mana ledger as amounts and dates without the player ID; an unmailed paid card order keeps its contact e-mail until it ships; a name shown with a donation is not linked to a player and stays unless asked); and the AI-request archive under its research ID. This replaces "Replays … are the one exception", which was no longer true. |
| E7 | Terms → Your player (new bullet, `#delete-player`) | New: "You can delete your saved player at any time in the player panel (“Delete my player…”). It deletes your sign-in, every character on your account, your progress and your World Index, and it can't be undone. What you wrote in chat and to the world planner, worlds you made, things you placed and what you shared in the Library stay, without your name, and you can't change or remove them afterwards. Our Privacy Policy lists what is deleted and what stays." |
| E8 | RESEARCH.md → Matches, rule 5 (Erasure) | Adds: "The same holds for what they wrote: their chat messages and planner conversations are kept as written, detached from the player (chat as “A former player”, planner history under a random stand-in per world), so a world's history has no gaps. The text itself is not altered, so it can still identify its author by what it says." |
| E9 | Terms → Games and matches → Replays stay (T5); Terms → Ending | "If you ask us to delete your player" → "If you delete your player"; "ask us to delete your player" → "delete your player" |

**In the game, at the are-you-sure step:** "Delete your player? This destroys everything about your player, on every device. It cannot be undone, and we can't bring any of it back." Then "What is destroyed" (sign-in, every character and its name, progress and awe, World Index, 18+ choice, asks to build, mutes, what minds remember) and "What stays, and why", which begins "What you wrote in world chat and to the planner stays, without your name. … If your words themselves say who you are, they still will.", then worlds and placed things without the name, Library items, replays with an anonymous "Player", money records, the research archive; a note on backups and on a name shown with a donation; a field "To delete your player, type DELETE"; and two buttons: "Delete my player forever" (off until the word is typed) and "Keep my player".

### Where the pages and the product disagree

5. **Unsaved (anonymous) players can't delete themselves.** The route refuses them and tells them to e-mail. An unsaved player still has rows (World Index, progress, chat, things placed) under its random ID. E4 says so ("If your player isn't saved, email us"); the person who answers that e-mail has no tool for it yet beyond running the same erase by hand.
6. **The genai-service's part is asked for, not guaranteed at once.** Job history and the Library (makers, the private trash) live in that service's own database. The sync-service tells it (`POST /forget`) and keeps the deleted player's random IDs in a queue (`erase_pending`) until it answers, retrying hourly. Until then E2 and "things of yours in the private Library trash" are not yet true for that player.
7. **Server logs.** Some log lines name a player's random ID (saving with a passkey, linking a device, saving a game). Deleting a player does not touch logs, and neither page gives a retention period for them. Privacy says only "our servers log requests (including IP address)".
8. **A typed donor name** can't be found from the player (gifts are not linked to players), so it stays unless the person asks. E4 says so.
9. **Other players' devices.** A device that visited a world keeps an offline copy of it (Privacy "On your device"). It picks up the change (name removed, chat lines gone) the next time it opens that world online; until then that copy still shows the old lines.
10. **Names inside text.** A character name typed in chat or to the planner (by the deleted player or anyone else), or said by a mind in a reply, is not found or removed: text is kept as written.
11. **Planner history keeps its research ID.** Each planner session row also carries the research ID it was studied under (as the AI-request archive does). The link from that ID to the player is deleted, but the ID still ties one former person's sessions in different worlds to each other, privately. The story stone does not use it.
12. **A planned item the deleted player added is locked.** A world's plan records who added each item, and only that player may rework or drop it. After the delete nobody is that player, so those items can no longer be reworked or dropped through the planner by anyone (what was already built from them can still be moved or removed in the world by its creator and builders). Handing them to the builders instead needs a planner change.
13. **`forgetPlayer` (research.ts) still deletes planner history.** Nothing calls it; the route uses `eraseRows`. It should be removed or pointed at `eraseRows` so nobody uses it by mistake.

### More questions for the lawyer

19. **Worlds stay, ownerless.** Is "your content stays for others, with your name removed" acceptable where the law gives a right to erasure, given the Terms' licence "ends when the content is deleted"? A player has no way to delete a world they made, before or after. Should deleting a player offer to delete worlds nobody else has built in?
20. **Reports and safety flags are deleted with the player.** Reports about the deleted player (with our copy of their chat as evidence) and their stopped requests go. Should some be retained for a period (abuse, legal claims), and should that be said on the page?
21. **A fresh start resets limits.** The same e-mail can sign up again at once as a new player, with new daily mana and world limits and no record of earlier reports. Acceptable, or should a hash of the e-mail be kept for a period to stop that (and disclosed)?
22. **Accounting retention.** We keep amounts, dates and payment references of card orders and remove the buyer's e-mail once the order is closed. Is the e-mail itself part of what non-profit accounting must retain?
23. **The notice e-mail.** After deleting, we send one last message ("Your Aweborn player was deleted… If it wasn't you: reply") to the address we just removed. Fine, or does it need saying on the page?
24. **Kept writing under an earlier promise.** People wrote chat and planner messages while the page said both would be deleted with the player. May the new rule apply to what was written before 2026-11-24, or must older text be deleted on request? Is "detached, text unchanged" erasure at all where a right to erasure applies (free text can identify its author), and do we need a way to ask for specific messages to be removed? Does this change need the "significant change: we'll let you know in the game" notice?
