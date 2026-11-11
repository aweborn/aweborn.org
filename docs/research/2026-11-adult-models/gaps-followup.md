# Follow-up: GPU hosts, text hosts and model licenses for 18+ worlds

*Research note, 2026-11-10. Closes three gaps left open by [reports/Adult capable models for Aweborn.md](reports/Adult%20capable%20models%20for%20Aweborn.md). Not legal advice.*

**Markers:** **[Unverified]** means the claim rests on a secondary source, a search snippet, an estimate, or a page that couldn't be read in full. **[Lawyer]** means counsel must answer it. **[Confirm in writing]** means Aweborn should get a written statement from the provider. Every policy was pulled on 2026-11-10, and policies change. Re-pull before relying on one.

## Recommendation

**GPU host. Two findings change the earlier report's advice to use a serverless GPU such as RunPod or Modal.** RunPod's Terms name "pornography or graphic adult content" as unauthorized content and threaten a lifetime ban. Modal's Terms forbid processing "indecent or obscene" content, and "indecent" is broad enough to cover legal adult art. Hetzner, Together and fal also ban porn or sexually explicit content in writing. Of the hosts whose terms could be read, these allow legal adult output:

- **Vast.ai**, whose terms ban only unlawful and "obscene" content
- **Replicate**, whose terms ban only "non-consensual nudity or illegal pornographic content" and openly warn that output may be pornographic

Baseten's policy text couldn't be retrieved. Its retention terms are the best of the group: by default it stores no inputs or outputs.

1. **Start on Vast.ai Secure Cloud** (vetted datacenter hosts only, never community hosts). Run one GPU of the RTX 3090 / A5000 / L4 class with Aweborn's own container behind Aweborn's own queue. No provider API sits in the request path, so nothing is retained unless Aweborn logs it. It costs about **$75–170/month** always-on, with no cold starts. Encrypt anything written to disk, because Vast's own docs say individual hosts have looser security.
2. **In parallel, ask Modal and Baseten in writing** whether stylized, non-photoreal adult art made by a customer's own model is allowed **[Confirm in writing]**. If either says yes, move to it. Modal deletes customer data "promptly following completion of processing" and Baseten stores no inputs or outputs by default. At 500 images a day, scale-to-zero billing costs about **$20–60/month**.
3. **Fallback: a Replicate deployment.** Its terms allow the use, but API inputs and outputs are kept for 1 hour, so it is "1-hour retention," not zero. Disclose that if it is used. Its idle billing also makes it the most expensive option, at about $100–260/month.

**Image model to start with:** **Illustrious-XL v1.1** for anime and stylized art, plus **Chroma1-HD** as the license-cleanest general model.

- **Illustrious-XL v1.1** is licensed under the SDXL CreativeML Open RAIL++-M. That license allows commercial use and has **no "money-making" clause**, which corrects the earlier report: only Illustrious *v0.1* used the Fair AI Public License (FAIPL).
- **Chroma1-HD** is Apache 2.0.
- **Do not use NoobAI-XL or Pony V6/V7.** NoobAI bans "any form of commercialization", Pony V6 bans inference on any site "allowing any form of monetization", and Pony V7 needs a separate license for any hosted service.
- **FLUX.2 [klein] 4B** is Apache, but its NSFW content was filtered out of the pretraining data, so it is weak at the job.
- **For 3D:** TripoSR (MIT, MIT dependencies) is clean. TRELLIS and TRELLIS.2 are MIT, but they depend on research-only libraries (nvdiffrast, diffoctreerast).

**Text hosts safe to put on the 18+ menu (via OpenRouter ZDR):**

| Verdict | Hosts |
|---|---|
| **Safe** | **DeepInfra** and **Parasail**: their terms are silent on adult content and they don't log content |
| **Conditional** **[Confirm in writing]** | **Fireworks** ("objectionable in our sole discretion"; full terms PDF unreadable), **Venice** (its terms warrant user content isn't "pornographic", yet it markets itself as "uncensored"), **Mancer** (bans "obscene, lewd" content; 2024 terms), **Nebius** (AUP bans "illegal pornography" defined partly *without* reference to legality) |
| **Exclude** | **Novita**: its AUP (Aug 5, 2026) bans content that "Is sexually explicit". **Together**: its ToS bans material that "constitutes pornography" |

In OpenRouter, send 18+ sexual-content requests with `provider.only` set to the verified hosts, or at minimum `provider.ignore: ["novita","together"]`, alongside `zdr: true`.

## Gap 1: GPU hosts for self-hosted explicit stylized images (and later 3D)

### Policy and retention

| Host | Adult content in AUP/ToS (verbatim) | Retention / logging | Scanning | Verdict |
|---|---|---|---|---|
| **RunPod** (pods + serverless) | ToS §6 (updated Mar 24, 2026): "Among unauthorized Content submitted to the Service includes: … pornography or graphic adult content, images, or other adult products." §7: content must not be "obscene, lewd, lascivious, filthy…". Violations "may result in immediate termination of your account and a lifetime ban" | No retention schedule in ToS. Serverless results are kept 30 min (`/run`) or 1 min (`/runsync`) and then deleted ([docs](https://docs.runpod.io/serverless/endpoints/send-requests.md)) | "will not actively monitor Content", but reports to CyberTipline | **Exclude** |
| **Modal** | Terms (effective May 2026) §1.4 "Prohibited Content" includes content that "contains indecent or obscene material". No sexual-content clause and no separate AUP | "Customer Data processed by the Service is expunged promptly following completion of processing" (§5.4). No training on Customer Data without consent. Account deleted within 60 days of termination | No monitoring right stated beyond suspension | **Conditional**: "indecent" is the risk **[Confirm in writing]** |
| **Vast.ai** | Terms (Sep 1, 2026), prohibited activity 21: no content that is "unlawful … obscene, or discriminatory". No sexual-content clause | Vast keeps no record of instance data. Marketplace hosts have physical/root access; Secure Cloud hosts are ISO 27001 / Tier 3–4 datacenters under DPAs ([security FAQ](https://docs.vast.ai/guides/reference/faq/security)) | "right but … not the obligation" to monitor the *Website* | **Allowed** (Secure Cloud only) |
| **Lambda** | AUP §1 (in Cloud Terms, Aug 2025): no "materials that are obscene, constitute illegal pornography, indecent, or hateful" | Raw VMs. Lambda "may maintain a copy … in accordance with Lambda's data retention practices" on termination | Right to investigate | **Conditional** ("indecent"). Also no scale-to-zero, so expensive |
| **Replicate** (custom models / deployments) | Terms (Apr 1, 2026) §2.7(d)(v) bans use "to create non-consensual nudity or illegal pornographic content". §8.6 *disclaims*: output may be "SUGGESTIVE, PORNOGRAPHIC, LASCIVIOUS …" and "REPLICATE DOES NOT CONDONE OR IN ANY WAY ENCOURAGE SUCH CONTENT CREATION". AUP: no "Distribution of obscene … content" | API predictions: "all input parameters, output values, output files, and logs are automatically removed after an hour". Web predictions are kept indefinitely ([docs](https://replicate.com/docs/topics/predictions/data-retention)). Terms §5.5: may use "Resultant Data" to improve services | No platform scanning documented. Safety checkers are per model | **Allowed** (legal adult). Retention is 1 h, not zero |
| **fal** (private / serverless apps) | AUP bans "any other harmful, violent, or sexually explicit content". The T&S page claims a separate "comprehensive NSFW content policy" | Payload JSON kept 90 days by default (serverless docs; 30 days on model-API docs). Disable with `X-Fal-Store-IO: 0`. App stdout/stderr kept 30 days and can't be turned off | **Yes.** Uses OpenAI Omni moderation and NCMEC/Thorn hash matching across the platform ([T&S](https://fal.ai/legal/trust-and-safety)) | **Exclude** unless fal confirms in writing |
| **Baseten** | **AUP text not retrievable** (JS-rendered page; ConductAtlas mirror withdrawn) **[Unverified]** | "Baseten does not store model inputs, outputs, or weights by default. Outputs are never stored." Async queue holds inputs ≤72 h. Security logs kept up to 4 years ([security docs](https://docs.baseten.co/observability/security)) | Unknown | **Unknown** **[Confirm in writing]**. Best retention of the group |
| **Together** (dedicated endpoints) | ToS §4.2 (May 19, 2026): no material that "is libelous, harmful to minors, obscene, or constitutes pornography" | ZDR available: "your data and outputs are not stored, retained, or used for model training" (§3.2) | "may monitor your use" (§1.4) | **Exclude** |
| **Hetzner** (GEX GPU servers) | GTC §8.2 and US Special Terms §4: customers may not publish "pornographic or obscene material, extremist content or content that offends common decency" | Bare metal, so Aweborn controls the data | DSA notice-and-action | **Exclude** |
| **OVHcloud** (US) | US ToS (May 15, 2025) §7(b): no content that is "illegal, unlawful, harmful, abusive …". No sexual clause found. EU terms not read **[Unverified]** | Bare metal / VMs | "right to verify Your compliance" | **Unclear**. No serverless; not pursued |

### Cost for ~500 images/day, bursty

Assumptions **[Unverified estimates; benchmark before relying on them]**:

- SDXL-class model at 1024², about 28 steps.
- Seconds per image: 4090 ≈ 4.5, L40S ≈ 3.5, A10/A10G ≈ 8.5, L4 ≈ 11, T4 ≈ 22.
- Bursty overhead on serverless (cold starts plus idle tails) ≈ 0.5 GPU-hour/day.
- Replicate's private-model billing includes setup and idle time, so assume 1–2 h/day of overhead there.

| Host | GPU and listed price | GPU-h/day | ≈ $/month | Cold start |
|---|---|---|---|---|
| Modal | L4 $0.000222/s (= $0.80/h); A10 $0.000306/s (= $1.10/h); $30/mo free on Starter ([pricing](https://modal.com/pricing)) | L4 ~2.0; A10 ~1.7 | L4 ~$49 (≈ $19 after credit); A10 ~$55 (≈ $25 after credit) | Memory snapshots: a Stable Diffusion function went from ~13 s to 3.5 s ([Modal blog](https://modal.com/blog/mem-snapshots)). GPU snapshots are experimental |
| Baseten | L4 $0.01414/min (≈ $0.85/h); A10G $0.02012/min (≈ $1.21/h), from search snippet **[Unverified]** ([pricing](https://www.baseten.co/pricing/)) | ~2.0 / ~1.7 | ~$52 / ~$61 | Not measured **[Unverified]** |
| Vast.ai Secure Cloud, always-on | Live offers 2026-11-10: datacenter RTX 3090 / A5000 ≈ $0.23/h; non-DC L4 ≈ $0.10/h, 4090 ≈ $0.15/h ([API snapshot](https://console.vast.ai/api/v0/bundles/)) | 24 | ~$75–170 | None. Vast Serverless exists but wasn't priced **[Unverified]** |
| Replicate | T4 $0.81/h; L40S $3.51/h. "you pay for all the time instances of the model are online", including setup and idle ([pricing](https://replicate.com/pricing)) | T4 ~4–5; L40S ~1.5–2.5 | T4 ~$100–120; L40S ~$160–260 | Not documented **[Unverified]** |
| RunPod serverless (excluded) | 4090 $1.34/h; L4/A5000 $0.75/h. Flex workers default to a 5 s idle timeout ([pricing](https://www.runpod.io/pricing), [docs](https://docs.runpod.io/serverless/pricing)) | ~1.1 / ~2.0 | ~$45 / ~$46 | FlashBoot timing not published |
| fal (excluded) | Smallest listed GPU is RTX PRO 6000 at $4.00/h; billed in SETUP and IDLE states ([pricing](https://fal.ai/pricing)) | ~0.9 | ~$100 | — |
| Together dedicated (excluded) | Per-minute billing while running; H100 $3.99/h; L40S $2.10/h per an older blog **[Unverified]** | 24 | ~$1,500+ | — |
| Lambda (conditional) | A10 $1.29/h, A6000 $1.09/h (prices effective Nov 16, 2026) ([pricing](https://lambda.com/pricing)) | 24 unless started/stopped by hand | ~$790–930 | — |
| Hetzner (excluded) | GEX44 ≈ €184/mo **[Unverified]** | 24 | ~$200 | — |

**Takeaway.** At this volume, scale-to-zero (Modal or Baseten) costs about $0.001–0.004 per image. A single always-on Vast.ai Secure Cloud card costs $0.005–0.011 per image, but it has no cold starts and the cleanest data path. All of these costs are small next to the moderation stack.

**Sources.** [RunPod ToS](https://www.runpod.io/legal/terms-of-service) · [Modal Terms](https://modal.com/legal/terms) · [Vast.ai Terms](https://vast.ai/terms) · [Vast.ai Privacy](https://vast.ai/privacy) · [Lambda Terms + AUP](https://lambda.com/legal/terms-of-service) · [Replicate Terms](https://replicate.com/terms) · [Replicate AUP](https://replicate.com/acceptable-use-policy) · [Replicate retention](https://replicate.com/docs/topics/predictions/data-retention) · [fal AUP](https://fal.ai/legal/acceptable-use-policy) · [fal T&S](https://fal.ai/legal/trust-and-safety) · [fal serverless retention](https://fal.ai/docs/documentation/serverless/data-retention) · [fal media expiration](https://fal.ai/docs/documentation/model-apis/media-expiration) · [Baseten security practices](https://www.baseten.co/security-practices/) · [Together ToS](https://www.together.ai/terms-of-service) · [Together Privacy §2.6](https://www.together.ai/privacy) · [Together dedicated endpoints docs](https://docs.together.ai/docs/dedicated-endpoints/overview) · [Hetzner GTC](https://www.hetzner.com/legal/terms-and-conditions/) · [OVHcloud US ToS](https://us.ovhcloud.com/legal/terms-of-service/). Secondary sources used only for leads: [ConductAtlas RunPod summary](https://conductatlas.com/platform/runpod/runpod-terms-of-service/).

## Gap 2: Text hosts for 18+ minds via OpenRouter (ZDR)

OpenRouter passes each provider's terms through to Aweborn ([OpenRouter Terms](https://openrouter.ai/terms)). A host's AUP therefore binds Aweborn's traffic even when the model's own license allows the content.

| Host (OR slug) | AUP/ToS text on sexual content (verbatim) | Retention / training | Verdict |
|---|---|---|---|
| **DeepInfra** (`deepinfra`) | Terms (Oct 15, 2026) have no sexual-content clause. Bans "any illegal, fraudulent, or deceptive purpose" (§11(a)(vii)) | Terms §7(b): will "not retain, store, or log any Customer Data … beyond the period strictly necessary to process and return the applicable request". Docs: "We do not log the content of your requests." Image outputs are kept briefly. Only metadata (request ID, cost, sampling params) is logged | **Safe** |
| **Parasail** (`parasail`) | Terms (Nov 10, 2025) have no sexual-content clause. Bans "any illegal or unauthorized purpose" (§2.2(j)) | "will only retain your Content for as long as is necessary to provide the Service". May "inspect prompt and usage metadata … masked" (§3.1–3.2). No training on Content (§2.7). Batch jobs kept 30 days | **Safe** (it's the sole host for Cydonia and Skyfall) |
| **Fireworks** (`fireworks`) | Terms (dated 7.10.26) bar content that "may be harmful or objectionable (in our sole discretion) to us or to our providers". The full PDF couldn't be parsed; this excerpt comes via [ConductAtlas](https://conductatlas.com/platform/fireworks-ai/fireworks-ai-terms-of-service/acceptable-use-policy-prohibited-content/) **[Unverified]** | "Fireworks does not log or store prompt or generation data for any open models, without explicit user opt-in." Prompt caches live in volatile memory for minutes; the Responses API keeps data 30 days | **Conditional** **[Confirm in writing]** |
| **Venice** (`venice`) | ToS (Jun 8, 2026) §10.9(c): user warrants a reasonable person could not deem User Content "objectionable, profane, indecent, pornographic …". §4: minors must not circumvent "the mature content filter". Markets "private and uncensored AI" | Privacy (Jun 2, 2026): "we will not have access to or store the content of your Prompts or Outputs". Runs ZDR with its model providers | **Conditional**: text contradicts its positioning **[Confirm in writing]** |
| **Mancer** (`mancer`) | Terms (Jun 6, 2024) item 1.1.5: content must not be "obscene, lewd, or offensive" or "otherwise objectionable (as determined by the Company)" | Privacy: records exclude "usage contents". But Terms let it use Customer Content to "develop, and improve" and to train unless you opt out. OpenRouter lists Mancer endpoints as ZDR | **Conditional**: "lewd" plus a stale 2024 policy **[Confirm in writing]** |
| **Nebius** (`nebius`) | AUP (effective Jun 26, 2026) cl. 1.1.3: no Content that "constitutes child or any other illegal pornography, relates to bestiality, or depicts non-consensual sex acts", nor "obscene" content. §14 defines "Illegal pornography" partly by a standalone test: graphic genital nudity that appeals to an "arousing and unwholesome interest in sex", is "patently offensive" and lacks "serious literary, artistic … value". That test doesn't require the material to be illegal | Token Factory terms (Aug 20, 2026) §7: stores Inputs/Outputs, including for speculative-decoding training, unless you opt out via tokenfactory-support@nebius.com. Newer customers fall under [docs.nebius.com/legal/agreement](https://docs.nebius.com/legal/agreement), which wasn't read **[Unverified]** | **Conditional**. Hermes 4 405B is Nebius-only |
| **Novita** (`novita`) | AUP (effective Aug 5, 2026) §5: "You may not submit, upload, transmit, or generate content through the Services that: … (7) Is sexually explicit." | Not read | **Exclude** |
| **Together** (`together`) | ToS §4.2 (May 19, 2026): no material that "is libelous, harmful to minors, obscene, or constitutes pornography" | ZDR when the store-prompts and training toggles are set to "No" | **Exclude** |

**Effect on the earlier menu.** Every model in the earlier report keeps at least one Safe host except these:

- **Hermes 4 405B** has only Nebius, which is conditional.
- **Dolphin-Venice** has only Venice, which is conditional.
- **Magnum v4 / Weaver / MythoMax** are Mancer-only (MythoMax may also be on Parasail), so they are conditional.
- **Kimi K3.1** should be routed to DeepInfra or Fireworks.
- **DeepSeek, GLM and Qwen** should be routed to DeepInfra or Parasail, never Novita or Together.

The generated menu's "verified host" list should start as {DeepInfra, Parasail} and grow as written confirmations arrive.

**Sources.** [DeepInfra Terms](https://deepinfra.com/terms) · [DeepInfra Privacy](https://deepinfra.com/privacy) · [DeepInfra data-privacy docs](https://docs.deepinfra.com/account/data-privacy) · [Parasail ToS](https://www.parasail.io/legal/terms-of-service) · [Fireworks ToS (PDF)](https://fireworks.ai/terms-of-service) · [Fireworks data handling](https://docs.fireworks.ai/guides/security_compliance/data_handling) · [Venice ToS](https://venice.ai/legal/tos) · [Venice Privacy](https://venice.ai/legal/privacy-policy) · [Mancer Terms](https://mancer.tech/terms) · [Mancer Privacy](https://mancer.tech/privacy) · [Nebius AUP](https://docs.nebius.com/legal/aup) · [Nebius Token Factory ToS](https://docs.tokenfactory.nebius.com/legal/terms-of-service) · [Novita AUP](https://novita.ai/legal/acceptable-use-policy) · [Together ToS](https://www.together.ai/terms-of-service) · [OpenRouter providers API](https://openrouter.ai/api/v1/providers).

## Gap 3: Model licenses

| Model | License (primary text) | Commercial / "money-making" clause | Free nonprofit service OK? | Other obligations |
|---|---|---|---|---|
| **Illustrious-XL v0.1** (early release) | `fair-ai-public-license-1.0-sd` (FAIPL) ([HF](https://huggingface.co/OnomaAIResearch/Illustrious-xl-early-release-v0)) | Base FAIPL has no commercial ban. The model card adds: "You are prohibited from monetizing any close-sourced fine-tuned / merged model" and "discourages the usage of model over monetization purpose" | Probably yes, if derivatives are published openly **[Lawyer]** | FAIPL network clause: if you **modify** and serve over a network, offer the source. Prohibited uses include harming minors ([FAIPL](https://freedevproject.org/faipl-1.0-sd/)) |
| **Illustrious-XL v1.0 / v1.1** | `sdxl-license` → CreativeML **Open RAIL++-M** (July 26, 2023) ([v1.1 card](https://huggingface.co/OnomaAIResearch/Illustrious-XL-v1.1), [license](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/LICENSE.md)) | **None.** Attachment A lists use restrictions only (unlawful use, "exploiting, harming or attempting to exploit or harm minors in any way", defamation, PII, etc.) | **Yes** | Pass Attachment A to users ("You shall require all of Your users … to comply"). Weights are published on HF |
| **Illustrious-XL v2.0** | Tagged `creativeml-openrail-m` with no LICENSE file ([HF](https://huggingface.co/OnomaAIResearch/Illustrious-XL-v2.0)) | No commercial ban in OpenRAIL-M | Yes, but the tag doesn't match its SDXL base **[Lawyer]** | Same as above. Prefer v1.1 for clarity |
| **NoobAI-XL** (1.1, V-pred 1.0) | FAIPL-1.0-SD plus added terms ([HF README](https://huggingface.co/Laxhar/noobai-XL-1.1)) | §II "Commercial Prohibition": "We prohibit any form of commercialization, including but not limited to monetization or commercial use of the model, derivative models, or model-generated products." §I: "Prohibited generation of unethical or offensive content." | **Doubtful.** Donations or a paid tier could count as "monetization". "Unethical or offensive" is undefined **[Lawyer]** | Must open-source derivatives *and* "Share work details such as synthesis formulas, prompts, and workflows" |
| **Pony Diffusion V6 XL** | "modified Fair AI Public License 1.0-SD" ([purplesmart.ai](https://purplesmart.ai/pony/content6x)) | "You are not permitted to run inference of this model on websites or applications allowing any form of monetization (paid inference, faster tiers, etc.). This applies to any derivative models or model merges." | **Only if Aweborn has no monetization at all.** Whether donations or "giving" count is open **[Lawyer]** | Civitai lists conflicting license metadata; trust the author's page |
| **Pony V7** | "Pony License" (updated Apr 4, 2025) ([purplesmart.ai/license](https://purplesmart.ai/license)). The HF LICENSE file is 0 bytes ([HF](https://huggingface.co/purplesmartai/pony-v7-base)) | The Small-Scale Commercial grant (< $1M revenue) requires that "Your use does not involve offering the Pony Materials or Derivative Works as a hosted service or application programming interface". Hosted use needs "a separate license … in its sole discretion" (§III.C). Non-Commercial = "not primarily intended for commercial advantage or monetary compensation" | Aweborn could fit "Non-Commercial Purpose" (§III.A, which doesn't mention hosting), but the hosted-service carve-out makes it **unsafe without a license from PurpleSmart** **[Lawyer]** | Bans content that "sexualizes minors". Note: fal is its "exclusive" commercial API partner |
| **Chroma / Chroma1-HD** | **Apache 2.0** ([HF](https://huggingface.co/lodestones/Chroma1-HD)). Based on FLUX.1-schnell (Apache) | None | **Yes** | Apache NOTICE and attribution if redistributed |
| **FLUX.2 [klein] 4B** | **Apache 2.0** ([HF](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)) | None in the license. The card lists out-of-scope uses ("non-consensual intimate imagery or illegal pornographic content", minors) and points to a BFL "Usage Policy (for our commercial open-weight model users)" that wasn't read **[Unverified]** | **Yes** | Pretraining was NSFW-filtered, so it's poor for explicit art |
| **TRELLIS / TRELLIS.2** | **MIT** for code and weights ([TRELLIS](https://github.com/microsoft/TRELLIS), [TRELLIS.2](https://github.com/microsoft/TRELLIS.2)) | None in MIT. **But dependencies:** nvdiffrast is the "Nvidia Source Code License (1-Way Commercial)", where "non-commercially means for research or evaluation purposes only" ([license](https://github.com/NVlabs/nvdiffrast/blob/main/LICENSE.txt)). diffoctreerast (Inria/MPII-derived) is "for research and/or evaluation purposes only" ([license](https://github.com/JeffreyXiang/diffoctreerast/blob/main/LICENSE)). TRELLIS.2 also lists nvdiffrec | **Not for the full pipeline** unless the research-only modules are replaced or licensed **[Lawyer]** | FlexiCubes is Apache 2.0 |
| **TripoSR** | **MIT**, "Copyright (c) 2024 Tripo AI & Stability AI", covering "the source code, pretrained models" ([GitHub](https://github.com/VAST-AI-Research/TripoSR), [HF](https://huggingface.co/stabilityai/TripoSR)) | None | **Yes** | Stability's AUP (Sep 30, 2026) "Prohibit[s] Sexually Explicit Content" for "Stability AI Technology". Its named scope is Stability's Non-Commercial, Community and Enterprise licenses, not MIT ([AUP](https://stability.ai/use-policy)). Whether it reaches an MIT co-release is **[Lawyer]** |

**Practical reading.** "Free nonprofit" is not the test in most of these licenses. NoobAI and Pony V6 turn on *any monetization of the site or app*, Pony V7 on *hosting*, and FAIPL on *publishing modifications*. If Aweborn takes donations, sells anything, or ever adds a paid tier, NoobAI and Pony V6 are likely out. The Open RAIL++-M (Illustrious v1.x), Apache (Chroma, FLUX.2 klein 4B) and MIT (TripoSR) models avoid the question entirely.

## Open items for a lawyer

1. **"Obscene" in every host's terms.** Vast.ai, Replicate (AUP), Lambda, Modal and Nebius all ban "obscene" content. Explicit stylized art could meet the Miller test in some US communities. Does Aweborn's 18+ content create host-contract exposure, and does 18 U.S.C. § 1466A change that for drawn content?
2. **Modal's and Lambda's "indecent".** Does "indecent" in a B2B contract reach legal adult art? (Ask Modal in writing as well.)
3. **Nebius §14 "illegal pornography" limb (a).** It is a content test that doesn't depend on legality. Does it apply to explicit *text* that "describes" sexual conduct?
4. **Monetization triggers.** Do Aweborn's donations, Stripe "giving" page, or any future paid tier count as "monetization" (Pony V6), "commercialization" (NoobAI) or "commercial advantage or monetary compensation" (Pony V7 Non-Commercial)? Is a free 501(c)(3) game a "hosted service" under Pony V7 §III.B–C?
5. **Illustrious lineage.** v1.x is relicensed under Open RAIL++-M but trained from the FAIPL v0.1. Can Onoma relicense its own copyleft release, and are there third-party contributions? Settle the v2.0 `openrail-m` tag mismatch.
6. **Open RAIL++-M flow-down.** What exact Attachment A text must Aweborn's Terms carry so that it "require[s] all of Your users" to comply?
7. **Stability AUP reach.** Does it reach SDXL derivatives under Open RAIL++-M (Illustrious) and the MIT TripoSR co-release, given that its named scope covers other license families?
8. **Research-only 3D dependencies.** Does a free nonprofit game count as "research or evaluation" under the nvdiffrast and Inria/MPII licenses? Probably not. Confirm before any TRELLIS deployment.
9. **Retention disclosures.** Is Replicate's 1-hour auto-deletion compatible with Aweborn's public zero-retention promise if disclosed, or must Aweborn avoid it? Do Vast.ai marketplace hosts' root access and Secure Cloud DPAs need naming in Privacy?
10. **Provider pass-through via OpenRouter.** Confirm that Aweborn, not OpenRouter, is liable under a host AUP (e.g. Together, Novita) if a request is routed there by mistake. This determines how strict `provider.only` enforcement must be.

**Written confirmations to request now:** Modal, Baseten, Fireworks, Venice, Mancer, Nebius, and fal (only if it is still being considered).
