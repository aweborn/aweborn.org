# Output-Safety Tooling for Aweborn's Hard Lines (as of Nov 2026)

Scope: tools, eligibility, costs and legal duties for checking every AI output and user upload on a small 18+ US 501(c)(3) platform. Research was run 2026-11-07 with about 20 search/fetch calls. Many vendor pages hide pricing behind sales calls, and some sources are old (2015-2021). Those are flagged inline.

## 1. CSAM hash matching and CSAM classifiers (PhotoDNA, Safer, Cloudflare, Google CSAI, Hive, NCMEC/IWF, ROOST)

### Takeaway
Hash matching is free or cheap for a vetted small ESP: PhotoDNA Cloud (free once vetted, images only), Cloudflare's CSAM Scanning Tool (free, no NCMEC credentials now, but only covers content served through Cloudflare cache), and NCMEC's Hash Sharing API once registered. But hashing only catches known, already-catalogued material, so it does almost nothing against freshly generated AI or stylized content. Novel-content detection (Thorn Safer Predict, Hive CSAM classifier, Google Content Safety API) needs vendor approval or a sales contract. None of them document how well they work on drawn or anime content.

### Cited Findings
**Microsoft PhotoDNA Cloud Service**
- Free "for qualified customers and developers", aimed at "trusted online service providers and businesses hosting user-generated content". Not for law enforcement. — [Microsoft PhotoDNA FAQ](https://www.microsoft.com/en-us/photodna/faq)
- You apply through an online form. Approval is case-by-case and a third party evaluates applications. API keys are issued only after vetting. — [PhotoDNA FAQ](https://www.microsoft.com/en-us/photodna/faq); [PhotoDNA Cloud Service](https://www.microsoft.com/en-us/photodna/cloudservice)
- Terms: free with limited transactions per month. High-volume use is billed as Content Moderator transactions. Internal use only, no managed-service resale. No SLA and no customer support. Microsoft may re-verify eligibility and suspend access at its sole discretion. — [PhotoDNA Terms of Use](https://www.microsoft.com/en-us/photodna/termsofuse) (the search surfaced a mix of current and 2018 terms versions, so re-check)
- Images only. Video is "being explored". — [PhotoDNA FAQ](https://www.microsoft.com/en-us/photodna/faq)
- Nothing on the page says whether nonprofits get any specific treatment. Eligibility rests on being a trusted UGC host. — same

**Cloudflare CSAM Scanning Tool**
- Scans content "served for your website through the Cloudflare cache". Content not proxied or cached through Cloudflare is not covered. — [Cloudflare docs](https://developers.cloudflare.com/cache/reference/csam-scanning/)
- The current docs ask only for a notification email. Since an April 2025 update, Cloudflare files hash-match reports to NCMEC as third-party reports using its own CyberTipline credentials, which removed the old requirement for customer NCMEC credentials. — [Cloudflare docs](https://developers.cloudflare.com/cache/reference/csam-scanning/); [INHOPE, Apr 15 2025](https://inhope.org/articles/cloudflare-simplifying-the-fight-against-csam); [Cloudflare Service-Specific Terms](https://www.cloudflare.com/service-specific-terms-application-services)
- On a match: a daily email with file paths from the past 24 hours, and Cloudflare tries to block further serving. It matches known lists only and does not detect novel material. — [Cloudflare docs](https://developers.cloudflare.com/cache/reference/csam-scanning/)
- The site owner keeps all legal duties: Cloudflare's reports "do not relieve you" of obligations, including preservation. The docs say to report to NCMEC, preserve securely, keep report information for 1 year with restricted access, then remove the content and notify Cloudflare. — [Cloudflare docs](https://developers.cloudflare.com/cache/reference/csam-scanning/); [Service-Specific Terms](https://www.cloudflare.com/service-specific-terms-application-services)
- The docs page does not say which plans include the tool. — [Cloudflare docs](https://developers.cloudflare.com/cache/reference/csam-scanning/)

**Thorn Safer / Safer Predict**
- Safer Predict launched July 22, 2024. It is AI detection of novel CSAM in images and video, plus text models that score whole conversations for CSAM, child access, sextortion and self-generated content. A "grooming" label was added later. — [Thorn blog: Introducing Safer Predict](https://www.thorn.org/blog/introducing-safer-predict-using-the-power-of-ai-to-detect-child-sexual-abuse-and-exploitation-online)
- Thorn's classifier finds new or unknown CSAM in images and video. Its SSVH perceptual video hashing matches visually distinct scenes. — [Thorn blog: CSAM classifier](https://www.thorn.org/blog/how-thorns-csam-classifier-uses-artificial-intelligence-to-build-a-safer-internet/)
- Pricing is not public. Vendr reports a median buyer spend of about $50,000/yr, ranging up to about $90,000, but that is based on only 3 purchases and may not be Safer-specific. — [Vendr: Thorn](https://vendr.com/marketplace/thorn)
- Safer offers self-hosted and API deployments (G2 listing, unverified for Safer Predict text). — [G2: Thorn](https://www.g2.com/sellers/thorn)

**Hive CSAM Detection API (powered by Thorn)**
- Combines Thorn's hash database ("57M+ known CSAM hashes", regularly updated from NCMEC) with an AI image and video classifier that labels content as CSAM, pornography or benign and returns risk scores. IWF hashes are available to IWF members. Video is supported via SSVH. — [Hive CSAM Detection](https://thehive.ai/apis/csam-detection)
- Hive's Arbiter review interface supports escalation and CyberTipline submissions to NCMEC. — [Hive CSAM Detection](https://thehive.ai/apis/csam-detection)
- Aimed at "every platform with an upload button". Pricing is "Contact Sales". The page says nothing about AI-generated, drawn or anime content. — [Hive CSAM Detection](https://thehive.ai/apis/csam-detection)
- Hive also offers a CSE text classifier powered by Thorn. — [Hive blog](https://thehive.ai/blog/expanding-hives-csam-detection-suite-with-text-classification-powered-by-thorn)
- thehive.ai/pricing now 301-redirects to deploy.com/pricing (seen 2026-11-07). That suggests a rebrand or restructuring. I did not fetch the new page.

**Google Content Safety API (CSAI)**
- Free for qualifying partners. Industry and civil-society organizations protecting their platforms can apply, subject to approval and Google's terms. — [Google: Tools for partners](https://protectingchildren.google/tools-for-partners/); [ROOST Coop integration doc](https://roostorg.github.io/coop/1.0/integrations/google-content-safety.html)
- It returns a priority score for human-review ordering, not a verdict. Partners must still review manually. — [ROOST Coop doc](https://roostorg.github.io/coop/1.0/integrations/google-content-safety.html); [BetaNews 2018](https://betanews.com/2018/09/03/google-content-safety-api) (old)

**NCMEC hash sharing**
- NCMEC provides a Hash Sharing API for pulling known-CSAM hashes, separate from the CyberTipline Reporting API. Credentials may be the same account or different ones. — [ROOST Coop NCMEC doc](https://roostorg.github.io/coop/1.0/integrations/ncmec.html)

**ROOST (open-source T&S infrastructure)**
- In July 2025 ROOST released Coop (a review and moderation platform built from ROOST-acquired Cove IP, with NCMEC-compliant CSAM reporting workflows) and Osprey (Discord's rules and investigation engine, which Bluesky also runs in production). — [Discord blog](https://discord.com/blog/roost-announces-coop-and-osprey-free-open-source-trust-and-safety-infrastructure-for-the-ai-era); [FOSDEM 2026 slides](https://fosdem.org/2026/events/attachments/U7ABHE-roost-osprey/slides/267291/roost_fos_91owhne.pdf)
- Coop ships integrations for NCMEC reporting and Google Content Safety API. Hasher-Matcher-Actioner (HMA) is listed in the ROOST ecosystem for hash matching. Coop v1.0.1 is listed as available May 2026. — [ROOST roadmap](https://roostorg.github.io/community/roadmap); [Coop NCMEC integration](https://roostorg.github.io/coop/1.0/integrations/ncmec.html)

**Does hash matching help with novel AI-generated CSAM?**
- No. Hashes only match material that has already been reported, classified and hashed. Crops and filters can produce new hashes. Classifiers are needed for novel material. — [ActiveFence](https://activefence.com/blog/detecting-csam-hash-matching) (vendor); [Thorn](https://www.thorn.org/blog/how-thorns-csam-classifier-uses-artificial-intelligence-to-build-a-safer-internet/)
- IWF reportedly recorded AI-generated child sexual abuse videos rising from 13 to 3,443 in 2025 ("260-fold"). This is secondary coverage and I did not verify it against the IWF primary report. — [AOL/news coverage](https://www.aol.com/articles/internet-watch-foundation-finds-260-215908079.html)

### Inferences
- For Aweborn, hashing is still useful for **user uploads**, where people may re-upload known real CSAM. It is close to useless for **model outputs**, which are novel by construction. The output path needs a classifier plus an apparent-age gate.
- Cloudflare's tool is the lowest-effort first layer if Aweborn already fronts its VPS with Cloudflare. It acts after serving (daily email), though, so it cannot be the pre-publication gate the hard-line policy requires. PhotoDNA, or NCMEC hashes run through HMA, is the pre-publication equivalent.
- The "real CSAM" classifiers (Thorn, Hive, Google) were trained on real abuse imagery. Their behavior on stylized or anime content is undocumented, so Aweborn should not assume they enforce an "apparent age in any art style" rule.

### Gaps
- Current Hive/"deploy.com" per-request pricing, and whether Hive's CSAM bundle is sold self-serve.
- Safer and Safer Predict pricing, and whether Thorn offers nonprofit or small-platform tiers.
- IWF hash list membership fees for a tiny US nonprofit. Not researched (budget).
- Tech Coalition Lantern eligibility (membership is industry-based and likely fee-bearing). Not researched.
- Project Arachnid (C3P). Its relevance to an ESP is mainly as a source of notices to remove content. Not researched.
- PhotoDNA's monthly free transaction cap. The figure was not found.

## 2. Apparent-age classifiers for stylized, anime and cartoon images

### Takeaway
No vendor I found publicly documents accuracy for apparent-age or minor detection on drawn content. The off-the-shelf options are general NSFW models, photo-oriented age estimators, and general multimodal guard models (Llama Guard 4, ShieldGemma 2). ShieldGemma 2 has no child-specific category. Enforcing "apparent age in any style" will likely need a custom stack: an NSFW/sexual detector, then an apparent-minor judgment (a vision-LLM judge and/or anime taggers), then human review of borderline cases.

### Cited Findings
- **ShieldGemma 2** (4B, built on Gemma 3) moderates natural and synthetic images against three policies: sexually explicit, dangerous content, and violence/gore. There is no child-specific policy. CSAM filtering is mentioned only as training-data cleaning. English only. — [ShieldGemma 2 model card](https://ai.google.dev/gemma/docs/shieldgemma/model_card_2); [arXiv 2504.01081](https://huggingface.co/papers/2504.01081)
- **Llama Guard 4** (12B, dense early-fusion, natively multimodal, supports multiple images) classifies prompts and responses using the MLCommons hazard taxonomy, where S4 is Child Sexual Exploitation. Meta says it matches or exceeds Llama Guard 3 on text and mixed text-image filtering. It is available on OpenRouter, which Aweborn already uses. — [Meta Llama Guard 4 docs](https://www.llama.com/docs/model-cards-and-prompt-formats/llama-guard-4/); [OpenRouter](https://openrouter.ai/meta-llama/llama-guard-4-12b/api); [NVIDIA model card](https://build.nvidia.com/meta/llama-guard-4-12b/modelcard). The S4 wording came via the [DeepInfra mirror](https://deepinfra.com/meta-llama/Llama-Guard-4-12B).
- **Sightengine** says its image moderation detects adult content, "children" and more. It lists an Age Estimation model and a `type` model (photo vs. illustration), but publishes no anime-age accuracy. Aggregators list plans from about $29/mo. — [Sightengine moderation principles](https://sightengine.com/docs/image-moderation-principles); [Sightengine nudity model](https://sightengine.com/docs/advanced-nudity-detection-model); [libraries.io client](https://libraries.io/pypi/sightengine); pricing via [fitgap aggregator](https://us.fitgap.com/products/024887/sightengine) (unverified)
- **AWS Rekognition** DetectModerationLabels is a Group 2 image API. Per-image tiers after the 2021 price cut were $0.001 / $0.0008 / $0.0006 / $0.0004, with a free tier of 5k images/mo for 12 months. — [AWS announcement 2021](https://aws.amazon.com/about-aws/whats-new/2021/11/amazon-rekognition-pricing-apis/); [AWS Rekognition pricing](https://aws.amazon.com/rekognition/pricing/) (the full table didn't render, so confirm the current rates)

### Inferences
- Llama Guard 4 via OpenRouter is the easiest image-plus-text guard to add to the existing pipeline. Its S4 is trained on real-world CSE notions, though, and its strictness on stylized adult characters is unknown. Aweborn needs its own red-team eval set before relying on it.
- An LLM-as-judge with a written apparent-age rubric (body proportions, facial maturity, school/child context cues, stated age) is the most controllable way to express an "any art style" rule. Llama Guard 4's own docs say it accepts custom category definitions, but I did not verify that in this session.
- Open-source anime taggers (WD14-family) and NudeNet are commonly used for this and could run on a VPS CPU or a small GPU. I did not source them in this session, and their accuracy on age-related tags is unverified.

### Gaps
- Independent benchmarks of any classifier's apparent-age accuracy on anime or stylized art. None were found.
- Hive's visual moderation classes for drawn content (Hive has historically had "animated"/"hentai" classes, unverified here) and Hive's current pricing.
- Google Vision SafeSearch behavior on drawings. Not researched.
- Primary sources for WD14 tagger, NudeNet and CLIP-based age classifiers.

## 3. Real-person likeness, deepfakes, NCII (StopNCII, celebrity recognition, photorealism)

### Takeaway
AWS Rekognition RecognizeCelebrities costs about $0.001/image or less and catches famous faces only, not private individuals. StopNCII lets any upload-accepting platform apply to receive victim-generated hashes, which is the only scalable control for private-person NCII. The TAKE IT DOWN Act has been enforceable since May 19, 2026: 48-hour removal, reasonable efforts to remove identical copies, FTC enforcement.

### Cited Findings
- RecognizeCelebrities is in the same Group 2 pricing tier as DetectModerationLabels, billed per image per API call (two APIs on one image = two charges). — [AWS Rekognition pricing](https://aws.amazon.com/rekognition/pricing/); [AWS 2021 price cut](https://aws.amazon.com/about-aws/whats-new/2021/11/amazon-rekognition-pricing-apis/)
- StopNCII: "any platform that accepts user uploads" can apply to become an industry partner by emailing joinstopncii@swgfl.org.uk. Hashes are generated on the victim's device and shared with partners to block uploads. TikTok and Bumble have joined, and Google has teamed with StopNCII. — [SWGfL new partners](https://swgfl.org.uk/magazine/new-industry-partners-join-stopncii-org-to-prevent-the-sharing-of-non-consensual-intimate-images-online/); [SWGfL on TAKE IT DOWN](https://swgfl.org.uk/magazine/the-take-it-down-act-has-been-passed-how-stopncii-org-can-support/); [ppc.land on Google](https://ppc.land/google-teams-with-stopncii-to-combat-intimate-image-abuse/)
- TAKE IT DOWN Act platform provisions took effect May 19, 2026. Covered platforms must provide a notice-and-removal process, remove reported NCII within 48 hours, and make reasonable efforts to remove identical copies. — [SWGfL](https://swgfl.org.uk/magazine/the-take-it-down-act-comes-into-force/); [Wiley via Mondaq](https://www.mondaq.com/unitedstates/advertising-marketing-branding/1790166/may-19-deadline-for-take-it-down-act-compliance-is-your-company-prepared)
- The FTC enforces it, with civil penalties of about $53,088 per violation. In May 2026 the FTC reportedly warned 12 large tech firms about possible violations (headline-level source). — [Wiley via Mondaq](https://www.mondaq.com/unitedstates/advertising-marketing-branding/1790166/may-19-deadline-for-take-it-down-act-compliance-is-your-company-prepared); [Pulse](https://www.pulse.bot/legal/news/ftc-warns-12-major-tech-firms-of-violating-take-it-down-act-f3691f31-c87e-4951-82fc-75c38be65cb1/)
- Sightengine offers a photo vs. illustration `type` classifier that can serve as a photorealism gate. — [libraries.io Sightengine client](https://libraries.io/pypi/sightengine)
- Hive markets a "Likeness Detection" API for characters and artworks, which is copyright-oriented. — [Hive blog listing](https://thehive.ai/blog/2024/page/2)

### Inferences
- A "no photoreal sexual content" policy, enforced with a photo/illustration classifier, removes most deepfake-NCII risk at low cost. Stylized explicit art of a recognizable real person is still possible (caricature, named-celebrity prompts). That means text-side checks (prompt and caption names a real person) plus celebrity face recognition on outputs.
- Private-individual likeness cannot be detected proactively without reference images. StopNCII hash matching and a fast takedown channel are the realistic controls.
- StopNCII hashes are PDQ/MD5-style perceptual hashes of the original images (reported elsewhere, not verified here). They match re-uploads of those images, not new AI renders of the same person.

### Gaps
- StopNCII's current partner onboarding requirements, cost (believed free) and hash format. Not confirmed from a primary page.
- Hive AI-generated/deepfake detection pricing and accuracy on stylized output.
- The statutory text of the TAKE IT DOWN Act. I relied on law-firm summaries; the "covered platform" definition was not checked.

## 4. Text classifiers (OpenAI moderation, Llama Guard 4, ShieldGemma, Perspective, Hive text, LLM-as-judge)

### Takeaway
OpenAI's omni-moderation is free and multimodal, but its terms for moderating non-OpenAI content are ambiguous (historically disallowed, later reworded). Llama Guard 4 covers S4 child exploitation plus violence, privacy and weapons categories and runs on OpenRouter. Thorn and Hive offer CSE-specific text classifiers for grooming and sextortion, contract-priced. An LLM judge (the current Haiku classifier) remains the most flexible way to encode Aweborn-specific rules.

### Cited Findings
- OpenAI's omni-moderation launch said it is "free to use for all developers" through the Moderation API, with usage-based rate limits. — [OpenAI omni-moderation developer info](https://cdn.openai.com/API/docs/omni_moderation_information_for_developers.pdf)
- Older OpenAI documentation said the endpoint is free "when monitoring the inputs and outputs of OpenAI APIs; other use cases are currently disallowed". The wording was later revised, and community threads dispute whether non-OpenAI content is now allowed. — [OpenAI community thread](https://community.openai.com/t/can-i-use-open-ai-moderation-api-agaist-non-open-ai-content-part-2/673566); [community thread 2](https://community.openai.com/t/has-the-moderation-api-changed-to-be-allowed-for-all-use-cases/652673)
- Llama Guard 4 classifies both prompts and responses, multilingual, text plus images. — [Meta docs](https://www.llama.com/docs/model-cards-and-prompt-formats/llama-guard-4/)
- Thorn Safer Predict text models score whole conversations line by line for CSAM, child access, sextortion, self-generated content and grooming. In its first year it processed more than 3M lines and flagged about 3,200. — [Thorn](https://www.thorn.org/blog/introducing-safer-predict-using-the-power-of-ai-to-detect-child-sexual-abuse-and-exploitation-online); [Thorn 12 years](https://www.thorn.org/blog/12-years-of-thorn)
- Hive CSE Text Classifier powered by Thorn. — [Hive blog](https://thehive.ai/blog/expanding-hives-csam-detection-suite-with-text-classification-powered-by-thorn)

### Inferences
- OpenAI moderation is a reasonable free second opinion for sexual/minors (it has a `sexual/minors` category) and violence, but Aweborn should get written confirmation from OpenAI before running third-party model output through it.
- A two-tier text pipeline fits the budget: a cheap guard model on everything (Llama Guard 4 or omni-moderation), then the Haiku judge with Aweborn's rubric for flagged or borderline items and for categories the guards lack (doxxing, mass-harm uplift).

### Gaps
- Perspective API status in 2026. I did not verify whether it is still offered (there have been reports of its wind-down), and in any case it targets toxicity, not these hard lines.
- ShieldGemma (v1, text) categories and current per-token prices for Llama Guard 4 on OpenRouter. Not fetched.

## 5. NCMEC CyberTipline registration, preservation and staff wellbeing

### Takeaway
18 U.S.C. § 2258A requires ESPs that get actual knowledge of apparent CSAM to report it to NCMEC's CyberTipline. Register as an ESP at esp.ncmec.org, then get Reporting API (and optionally Hash Sharing) credentials. The REPORT Act (signed May 7, 2024) extended mandatory preservation from 90 days to 1 year, requires NIST-CSF-aligned secure storage, and raised penalties. Wellbeing guidance was not researched in depth.

### Cited Findings
- Registration is via NCMEC's ESP portal (esp.ncmec.org/registration), or by emailing ESPteam@ncmec.org to start vetting. Historically, any US company providing an ECS or RCS to the public could register. — [dev.to summary](https://dev.to/sentinelsafety/ncmec-mandatory-reporting-for-online-platforms-what-developers-need-to-know-4k74); [NCMEC archived page](https://webarchive.library.unt.edu/web/20170118202100/http://www.missingkids.com/cybertipline); [AWS re:Post guide](https://repost.aws/articles/ARNf4emc2xQXal4EeUSN1b9Q/aws-customer-guide-leveraging-global-child-safety-partnerships-for-csea-prevention)
- The CyberTipline Reporting API takes report XML and returns a reportId, and files are uploaded separately. Docs are at report.cybertip.org. ROOST Coop has a built-in integration. — [ROOST Coop NCMEC](https://roostorg.github.io/coop/1.0/integrations/ncmec.html); Go client: [ncmec-go](https://pkg.go.dev/github.com/Boostport/ncmec-go/cybertipline)
- Reports must include the reporting ESP's identity, a copy of each visual depiction, and the apparent violator's electronic address. — [dev.to summary of § 2258A](https://dev.to/sentinelsafety/ncmec-mandatory-reporting-for-online-platforms-what-developers-need-to-know-4k74) (secondary)
- The REPORT Act (Pub. L. 118-59, signed May 7, 2024) extends preservation after a report from 90 days to 1 year. It allows voluntary longer retention to reduce exploitation, requires preserved material to be stored consistent with the NIST Cybersecurity Framework, covers apparent child sex trafficking and enticement as reportable, and increases fines for knowing and willful failure to report (tiered by monthly active users). — [Public Law 118-59](https://www.govinfo.gov/link/plaw/118/public/59); [WSGR summary](https://www.wsgrdataadvisor.com/2024/05/new-minor-safety-obligations-for-online-services-report-act-expands-child-sexual-exploitation-reporting-requirements/)
- Cloudflare's docs mirror this: keep report information for 1 year and restrict access to the people handling legal requests. — [Cloudflare docs](https://developers.cloudflare.com/cache/reference/csam-scanning/)

### Inferences
- Under § 2258A, report what is *apparent* CSAM, which arguably includes realistic AI-generated depictions. Whether purely stylized or anime outputs are reportable is a legal question for counsel. NCMEC accepts reports of GAI CSAM. Policy suggestion: block all apparent-minor sexual outputs, and report the ones that are photorealistic or realistic as well as any uploads.
- Preservation storage should be a separate encrypted bucket with access logging and 1-year retention. It must never be reachable by the game's normal app paths.
- Wellbeing for a solo founder: minimize human exposure. Auto-block on hash match without viewing, use blurred or grayscale review UIs (Hive Arbiter and Coop offer review tooling), and limit review sessions. These are standard industry practices; I found no specific sourced guidance in this session.

### Gaps
- NCMEC's current official ESP onboarding page and timelines (only secondary sources were found).
- An authoritative source on whether NCMEC wants reports of non-photoreal drawn content, and how federal law (18 U.S.C. § 1466A obscene visual representations) applies to it.
- Tech Coalition or Thorn moderator-wellbeing resources.

## 6. Cost per check and a practical design for a tiny team

### Takeaway
The cheapest compliant stack mixes free vetted programs (PhotoDNA or NCMEC hashes via HMA, StopNCII, Cloudflare scanning, Google CSAI if approved) with per-call guard models: AWS Rekognition at about $0.001/image per API, Llama Guard 4 on OpenRouter, and the existing cached Haiku judge. Thorn and Hive novel-CSAM classifiers are probably five-figure annual contracts, based on one weak data point.

### Cited Findings
- PhotoDNA Cloud: $0 for vetted customers within the monthly transaction limit. — [PhotoDNA Terms](https://www.microsoft.com/en-us/photodna/termsofuse)
- Cloudflare CSAM scanning: no separate charge mentioned; requires the Cloudflare cache. — [Cloudflare docs](https://developers.cloudflare.com/cache/reference/csam-scanning/)
- AWS Rekognition Group 2 (moderation, celebrity, face detection): $0.001/image at the first tier, falling with volume, plus a 12-month free tier of 5k/mo. Each API is billed separately. — [AWS 2021](https://aws.amazon.com/about-aws/whats-new/2021/11/amazon-rekognition-pricing-apis/)
- Thorn: about $50k/yr median spend (n=3; weak). — [Vendr](https://vendr.com/marketplace/thorn)
- Sightengine: from about $29/mo (aggregator). — [fitgap](https://us.fitgap.com/products/024887/sightengine)
- ROOST Coop, Osprey and HMA are free and open source. — [ROOST](https://roost.tools/blog/roost-in-review-a-look-back-on-2025/)

### Inferences (design sketch for the report writer)
1. **Upload path** (user images and audio): perceptual hash against NCMEC hashes (via HMA) or PhotoDNA, plus StopNCII hashes. On a CSAM match: auto-quarantine without human view, preserve to the encrypted 1-year store, file a CyberTip. Then the same output checks as below.
2. **Output path** (every generated image, 3D render or video frame sample):
   a. photo vs. illustration gate, where photoreal plus sexual is blocked outright;
   b. NSFW/sexual detector (Rekognition or Sightengine, or an open-source model on the VPS);
   c. if sexual: apparent-minor check, combining Llama Guard 4 S4 and an LLM vision judge with an Aweborn rubric; any positive is blocked, and borderline cases are held with the blur on for review;
   d. celebrity recognition on any image containing a face, so that a real person plus sexual is blocked;
   e. optionally, Google CSAI priority score or Hive/Thorn classifier, if approved or affordable.
3. **Text and transcripts**: Llama Guard 4 or omni-moderation first pass, then the cached Haiku judge with a hard-line rubric (minors, real people, doxxing patterns such as addresses and phone numbers, mass-harm uplift, incitement).
4. **Takedown channel**: a public NCII/CSAM report form with a 48-hour SLA timer (TAKE IT DOWN), hash-based removal of identical copies, and an audit log.
5. Use ROOST Coop as the review queue and NCMEC reporting UI rather than building one.
- Rough per-image cost: Rekognition moderation plus celebrity is about $0.002, guard and judge calls are probably fractions of a cent with caching, and hashing is $0. The total is likely under $0.01/image. That last figure is an inference and has not been priced against current OpenRouter rates.

### Gaps
- Current OpenRouter per-token pricing for Llama Guard 4 and Haiku with image inputs.
- Hive's current pricing (the site now redirects to deploy.com).
- Whether Cloudflare's tool would scan assets served from an R2 bucket or a Worker. The docs only say "Cloudflare cache".
