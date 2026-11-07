# 3D-model and voice/music/sound providers: adult-content policies for an 18+ platform (as of Nov 2026)

Method note: primary policy pages were fetched on 2026-11-07 where possible. Tripo's terms page and OpenAI's usage policies returned HTTP 403, and Meshy's NSFW-filter help article returned 404, so those are gaps. Items marked **[not re-verified]** come from model cards and licenses known before this session. They are cited to the canonical URL but were not re-fetched this session (budget ran out). Verify them before relying on them.

## 1. 3D generation: AUPs, licenses, hosted availability, prices, stylized-nude image→3D, rigging

### Takeaway
None of the hosted commercial 3D generators that could be checked allow pornographic output. Meshy bans "Pornographic material" outright, and Hyper3D/Rodin bans porn prompts. That puts Aweborn's current Meshy setup in conflict with explicit 18+ models. Meshy's ban on "pornographic material" is not a ban on all nudity, but a filter exists. Self-hosting an open-weight model is the realistic route for explicit stylized assets. Even so, Hunyuan3D's license excludes the EU, UK and South Korea, and Stability's AUP (which covers Stable Fast 3D / SPAR3D) bans sexually explicit content even on self-hosted weights. That leaves MIT/Apache-licensed models such as TRELLIS and TripoSR as the cleanest options.

### Cited Findings
**Meshy (current provider)**
- Meshy AUP rule 1 prohibits "Pornographic material" and "Depictions of nude minors or minors in a sexual manner"; "We may take action on your Meshy account if we discover content or behavior that violates this AUP." Last Modified November 11, 2024. — [Meshy AUP](https://www.meshy.ai/acceptable-use-policy)
- A search snippet of Meshy's terms/help describes prohibited content as "NSFW, nudity, violent or pornographic images, and adult content." Meshy has a help-center article titled "NSFW filter" (the URL now returns 404, so I could not read its details). — [Meshy help: NSFW filter (404 at fetch time)](https://help.meshy.ai/en/articles/11973519-nsfw-filter)
- Meshy Terms of Use (Last Updated September 19, 2026) set these retention rules: API output (non-Enterprise) "will be deleted three (3) days after it is generated"; Enterprise output is "retained indefinitely by default"; web-app storage limits may apply. — [Meshy Terms](https://www.meshy.ai/terms-of-use)
- Meshy may use content "from non-Enterprise Customers to train, validate, test, or improve Services." You can opt out by emailing support@meshy.ai. — [Meshy Terms §2.9](https://www.meshy.ai/terms-of-use)
- Ownership: on the free plan Meshy owns the output, which is licensed CC BY 4.0. Paid customers "own their Customer Output." Models posted to the Community page become CC0. — [Meshy Terms §3.2–3.3](https://www.meshy.ai/terms-of-use)
- Pricing: Free $0 (100 credits, 1 task); Pro $20/mo (1,000 credits); Premium $40/mo (3,000); Ultra $100/mo (8,000); Studio $70 team plus $10/seat (5,500 shared); Enterprise custom. API access starts at Pro. Rigging and animation are on every plan (free gets 20 animation-library entries, paid gets 500+). Remesh is paid-only. The pricing page lists no per-operation API credit costs and no nonprofit discount (it links only to an "Education Program"). — [Meshy pricing](https://www.meshy.ai/pricing)

**Hyper3D Rodin (Deemos)**
- Section 5 of the terms prohibits "Prompts that include porn, advertising or someone else's creation or image." Rodin outputs can be used without Deemos limiting the use (commercial use is allowed). ChatAvatar outputs are personal-use CC unless you buy a license. Deemos may use prompts and outputs "to provide, maintain and improve our services, and conduct and support research." The page shows no revision date (© 2026 footer). — [Hyper3D Terms](https://hyper3d.ai/legal/terms)

**Tripo**
- Tripo's terms page returned 403, so I could not read its own clause. A third-party app built on Tripo (Lychee) bans nudity and sexual content and references "the policies of its generation partner, Tripo AI." A Tripo blog post on NSFW handling exists but also returned 403. — [Tripo NSFW blog (403)](https://www.tripo3d.ai/blog/explore/ai-3d-model-generator-nsfw-and-restricted-content-handling); [Tripo terms (403)](https://www.tripo3d.ai/terms)

**Industry context (asset marketplaces)**
- TurboSquid bars erotic nudity and sexual contact but allows adult nudity for anatomical detail. Sketchfab allows nudity behind an opt-in age-restricted filter. CGTrader does not allow adult/NSFW uploads. — [TurboSquid policy](https://www.turbosquid.com/help/en/articles/9937531-turbosquid-s-policy-on-mature-and-other-prohibited-content); [Sketchfab age-restricted](https://sketchfab.com/blogs/community/sketchfab-introduces-age-restricted-content-filtering); [CGTrader](https://help.cgtrader.com/hc/en-us/articles/360015142337-Can-I-upload-adult-NSFW-content)

**Open-weight 3D models**
- The Tencent Hunyuan 3D 2.1 Community License (released June 13, 2025) says: "THIS LICENSE AGREEMENT DOES NOT APPLY IN THE EUROPEAN UNION, UNITED KINGDOM AND SOUTH KOREA." Its Territory is worldwide excluding those regions. Products with ">1 million monthly active users" need a separate Tencent license. The AUP has no explicit sexual-content clause; it bars exploiting or harming minors (item 6) and uses that "violates or disrespects the social ethics and moral standards of other countries or regions" (item 15, which is vague). — [Hunyuan3D-2.1 LICENSE](https://huggingface.co/tencent/Hunyuan3D-2.1/blob/main/LICENSE)
- The fal.ai Hunyuan3D v2.1 endpoint cost $0.30 per generation, but the page now marks it "deprecated" and "no longer supported." The page shows no NSFW policy, only links to Trust & Safety. — [fal Hunyuan3D v2.1](https://fal.ai/models/fal-ai/hunyuan3d-v21)
- The Stability AI AUP (effective September 30, 2026) says: "We Prohibit Sexually Explicit Content … content relating to sexual intercourse, sexual acts, or sexual violence." It covers all "Stability AI Technology," including self-hosted weights. That covers Stable Fast 3D / SPAR3D (3D category) and Stable Audio. — [Stability AUP](https://stability.ai/use-policy)
- TRELLIS (Microsoft) is released under the MIT license. TRELLIS.2 also appears to be MIT. **[not re-verified]** — [TRELLIS GitHub](https://github.com/microsoft/TRELLIS)
- TripoSR (Tripo + Stability) is MIT-licensed. **[not re-verified]** — [TripoSR HF](https://huggingface.co/stabilityai/TripoSR)
- Stable Fast 3D is under the Stability AI Community License (free under $1M annual revenue), so the Stability AUP above applies. **[license not re-verified; AUP verified]** — [SF3D HF](https://huggingface.co/stabilityai/stable-fast-3d)

### Inferences
- Meshy cannot legitimately produce explicit 18+ assets. "Pornographic material" is banned, and a filter exists. Non-sexual stylized nudity (fantasy creatures, sculpted figures) is a grey area that the AUP text alone does not settle. Expect the filter to block nude reference images regardless.
- Rodin bans porn prompts, though the clause speaks to prompts rather than image inputs. Treat it as not permitted.
- Explicit stylized 3D essentially requires self-hosting, ideally TRELLIS or TripoSR (MIT) on rented GPUs. Hunyuan3D is technically usable for a US-only service but legally can't be offered to EU/UK/KR users, and its "moral standards" clause is ambiguous. Stability 3D models are excluded by their AUP for sexually explicit content.
- Rigging/animation: Meshy's auto-rig and animation library is SFW-gated by the same AUP. Common alternatives are Mixamo (Adobe terms) and open tooling (Blender Rigify, UniRig/Make-It-Animatable research code). None of these were verified this session.
- The 3-day API retention and opt-out-only training at Meshy matter for privacy. Explicit test inputs could enter training unless Aweborn opts out.

### Gaps
- Tripo's actual ToS/NSFW clause and pricing (403). CSM, Luma (Genie), Sloyd and Kaedim policies were not fetched (budget).
- Meshy's NSFW filter details (whether it can be disabled, whether it scans image inputs, API vs web) are unknown because the article is 404.
- Whether image→3D on a stylized nude image is blocked by each provider: no empirical or documented answer was found.
- Current fal/Replicate prices for TRELLIS, Rodin, Tripo and Meshy endpoints were not retrieved.
- Mixamo terms on adult characters were not verified.

## 2. Voice/TTS: ElevenLabs and alternatives; adult/erotic speech; cloning real people

### Takeaway
As of its 09 Oct 2026 policy, ElevenLabs does **not** ban erotic audio generally. Its sexual-content ban covers "visual depictions of explicit sexual acts," erotica involving incest, bestiality or necrophilia, non-consensual intimate content, and anything sexualizing minors. Read literally, consensual adult erotic *speech* is permitted. Cartesia and Hume likewise have no adult-content ban beyond minors (Cartesia keeps an "objectionable" discretion clause). Fish Audio bans sexually explicit "User Submissions." Every provider requires consent before cloning a real person's voice.

### Cited Findings
- ElevenLabs Prohibited Use Policy (Last updated 09 October 2026), §6 "Prohibited Sexual and Graphic Content": "You may not use our Services to create or distribute certain forms of sexual or graphic content. This includes: Visual depictions of explicit sexual acts; Erotic material involving incest, bestiality, or necrophilia; Non-consensual intimate content; Gratuitous graphic or gory content…" The policy does not mention age verification, adult audio or companion characters. — [ElevenLabs Use Policy](https://elevenlabs.io/use-policy)
- ElevenLabs on minors: bans "content that exploits, endangers, or sexualizes anyone under 18" and "real or AI-generated material that sexually exploits or abuses minors." "You may not submit voice recordings of anyone under 18 to create or train a voice model." — [ElevenLabs Use Policy](https://elevenlabs.io/use-policy)
- ElevenLabs on cloning: bans "Cloning, synthesizing, or impersonating the voice, identity, or likeness of any living individual … without their explicit and informed consent or other valid authorization," and of deceased individuals "in a manner that is reasonably likely to cause harm." It provides an "Unauthorized Use of Voice report." — [ElevenLabs Use Policy](https://elevenlabs.io/use-policy)
- Cartesia AUP (Last revised July 23, 2025): has no dedicated adult/sexual section. It bans sexualization of minors and any output that "relates to, or appears in our sole discretion to relate to" persons under 18, plus "objectionable" content at Cartesia's discretion. Cloning: "You may only submit your own voice and audio recordings or those of others with explicit consent." — [Cartesia AUP](https://cartesia.ai/legal/acceptable-use)
- Hume AI AUP (Last updated July 15, 2025): bans "material that exploits or sexualizes minors" and "Creating voice outputs that replicate others without clear, affirmative consent." It contains no text about sexual or adult content otherwise. — [Hume AUP](https://hume.ai/acceptable-use-policy)
- Fish Audio Terms (Effective August 18, 2024): User Submissions may not "contain sexually explicit content or pornography." "Usage Data and Content may be used to develop, train, or enhance artificial intelligence or machine learning models." Deleted content may not be fully removable. There is no explicit voice-cloning consent clause beyond impersonation. — [Fish Audio Terms](https://fish.audio/terms)
- OpenAI: its usage policies page returned 403. News coverage says OpenAI planned an opt-in "adult mode" allowing erotica for age-verified adults in ChatGPT, targeted for Q1 2026, then delayed more than once. No confirmed launch was found as of this research, and none of the coverage says the change extends to the TTS API. — [Tom's Guide](https://www.tomsguide.com/ai/chatgpt/chatgpt-plans-to-launch-adult-mode-in-early-2026-heres-what-that-means); [Decrypt](https://decrypt.co/352189/sorry-gooners-openai-erotic-chatgpt-delayed-2026); [eWeek](https://www.eweek.com/news/chatgpt-adult-mode-delay/)
- Open TTS licenses **[not re-verified]**: Kokoro-82M is Apache-2.0 ([HF](https://huggingface.co/hexgrad/Kokoro-82M)). Chatterbox (Resemble AI) is MIT and embeds a Perth watermark ([GitHub](https://github.com/resemble-ai/chatterbox)). F5-TTS code is MIT but its pretrained weights are CC-BY-NC-4.0, so not commercial ([HF](https://huggingface.co/SWivid/F5-TTS)). XTTS-v2 is under the Coqui Public Model License, which is non-commercial, and Coqui shut down in 2024 so commercial licenses can't be bought ([HF](https://huggingface.co/coqui/XTTS-v2)). Permissive open licenses carry no content AUP, so adult speech is unrestricted by the license.

### Inferences
- ElevenLabs can likely remain the voice provider for consensual adult romantic/sexual dialogue among adult characters. The ban is phrased around *visual* depictions, plus specific taboo categories and non-consent. Aweborn's hard-line filters should mirror those carve-outs exactly: no incest, bestiality or necrophilia, no non-consent, no minors or childlike voices. Get written confirmation from ElevenLabs Trust & Safety before launch, because the "visual" wording is unusual and could be tightened.
- Cartesia and Hume are plausible backups. Their "objectionable/sole discretion" language means a ToS-permitted use can still be terminated.
- For zero platform-dependency, Kokoro (Apache) or Chatterbox (MIT) self-hosted are the commercially clean options for a nonprofit. Avoid F5-TTS weights and XTTS-v2 (non-commercial).
- Voice cloning of real people (celebrities, users' exes) must be blocked by every provider. Only consented self-voices or synthetic designed voices are acceptable.

### Gaps
- PlayHT, Resemble (hosted), Inworld and OpenAI TTS policies were not fetched (OpenAI returned 403). PlayHT's status after its 2025 acquisition was not checked.
- Per-character TTS prices and retention/training terms for ElevenLabs, Cartesia and Hume were not retrieved.

## 3. Music/SFX: explicit lyrics, sexual content, commercial licensing for a nonprofit

### Takeaway
Suno bans "sexually explicit content," including audio. Stability's AUP bans sexually explicit content for Stable Audio, including self-hosted. ElevenLabs Music falls under the same Prohibited Use Policy as voice, plus Music Terms with a plan-based commercial-rights table. Background music and SFX for 18+ worlds rarely need explicit content, so music providers mostly matter for licensing rather than adult permissions.

### Cited Findings
- Suno Safety Center lists "sexually explicit content" (explicit visual or audio sexual content) as disallowed, with zero tolerance for content targeting minors. Prompts can be flagged before generation, and repeat violations can lead to bans. Two versions of the guidelines exist (dated Jan 29, 2025 and Aug 6, 2026), and I couldn't confirm which is live. — [Suno Safety](https://suno.com/safety); [Suno guidelines](https://suno.com/community-guidelines); [Suno moderation FAQ](https://help.suno.com/en/articles/3198209)
- ElevenLabs Music Terms (updated 09 Oct 2026) incorporate a "Music Commercial Rights Table," so commercial rights depend on plan. The archived v1 terms (archived Nov 21, 2025) limited free-tier use and restricted some paid tiers from ads, film or TV. Prompts may not include real artist names or well-known lyrics. — [ElevenLabs Music Terms](https://elevenlabs.io/music-terms); [Archived v1 terms](https://elevenlabs.io/archived-eleven-music-v1-terms)
- Stability AI AUP bans sexually explicit content across Stability Technology, Stable Audio included, even when self-hosted. — [Stability AUP](https://stability.ai/use-policy)
- Udio: no primary explicit-content policy was found. Secondary sources say Udio settled with major labels in late 2025 and that paid tiers grant commercial use. — [aimagicx comparison (secondary)](https://www.aimagicx.com/blog/suno-vs-udio-vs-elevenlabs-music-comparison-2026)
- MusicGen (Meta AudioCraft) weights are CC-BY-NC-4.0, so not commercial. **[not re-verified]** — [MusicGen HF](https://huggingface.co/facebook/musicgen-large)

### Inferences
- Keep ElevenLabs Music/SFX for non-explicit ambience. Sexual lyrics or vocal content should be avoided or self-hosted with a permissively licensed model.
- 501(c)(3) status doesn't relax commercial-use clauses. Game distribution counts as use under these licenses, so a paid tier with commercial rights is needed.

### Gaps
- Udio's own terms and explicit-lyrics policy, ElevenLabs SFX pricing, and open music models with commercial licenses (e.g., ACE-Step, YuE, Stable Audio Open's license) were not verified this session.
- No nonprofit discounts were found for any music provider.

