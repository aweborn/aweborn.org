# Image models and hosted providers for stylized adult imagery (Aweborn, as of Nov 2026)

Research date: 2026-11-07. About 23 search and fetch calls. Many sources are third-party blogs or aggregators; I flag these where they appear. Primary pages I fetched directly were fal's AUP and Trust & Safety pages, Replicate's safety-checking doc, and a May 2026 GPU cost article. Several primary policy pages (Together AUP, BFL usage policy, xAI AUP, NovelAI ToS, Runware docs, DeepInfra, Fireworks, Civitai generation API) were **not** retrieved. Verify them before any decision.

## Q1. Hosted APIs: AUPs on sexual content, NSFW toggles, enforcement

### Takeaway
Most "open-weight hosting" providers (fal, Replicate, Runware, ModelsLab, and probably Together) ship a per-request safety checker that can be turned off through the API. Their written AUPs are vague on consensual adult content between fictional characters. All of them ban CSAM, NCII, and sexual depictions of real people without consent, and say they can suspend accounts. Closed first-party APIs (Stability, BFL, xAI, Leonardo) are stricter. Stability bans sexually explicit content outright. xAI's API has no documented adult tier and carries heavy 2026 regulatory risk.

### Cited Findings
**fal.ai**
- The fal AUP (no last-updated date; footer says 2026) never mentions "adult", "NSFW" or "nudity" by name. It prohibits "Depicting the likeness of an individual in a sexual or pornographic manner without their consent" and "any other harmful, violent, or sexually explicit content". Users must be 18 or older. — [fal AUP](https://fal.ai/legal/acceptable-use-policy)
- The same AUP bans sexualization of minors and CSAM, and lists "Identity theft, impersonation, or deepfakes". Enforcement: "Any breach of this policy or misuse of the fal Services may result in suspension or termination of your account." fal may also block IPs or domains and report violations to authorities. — [fal AUP](https://fal.ai/legal/acceptable-use-policy)
- fal's Trust & Safety page says fal "has formally adopted a comprehensive NSFW content policy governing permissible and prohibited content" with "clear prohibitions on unlawful categories, including CSAM, NCII, and other illegal material". The NSFW policy text itself is not on the page. — [fal Trust & Safety](https://fal.ai/legal/trust-and-safety)
- The `enable_safety_checker` boolean on fal image endpoints is documented by third-party tutorials, not by fal docs I retrieved. — [Apidog fal tutorial](https://apidog.com/vi/blog/fal-ai-api/); [HF demo discussion](https://huggingface.co/spaces/akhaliq/flux-pro-v1.1-fal-ai-api/discussions/1)
- One unverified secondary source says Pony V7's paid API for larger businesses is hosted through FAL.ai. — [aiofm.info](https://aiofm.info/en/guides/pony-vs-illustrious)
- Tension to flag: the "sexually explicit content" clause in fal's AUP conflicts with the existence of an "NSFW content policy governing permissible … content". I could not tell whether explicit fictional adult content is allowed. Ask safety@fal.ai in writing. — [fal Trust & Safety](https://fal.ai/legal/trust-and-safety)

**Replicate**
- Image models such as SDXL and Flux include a safety checker that blocks "nudity, violence, and other unsafe content". It is enforced for web predictions on SDXL and Flux base models and "all derivative fine-tunes". It "can sometimes be too restrictive or generate false positives". Through the API you can disable it and use a "custom safety-checking model or a third-party service". For allowed use, the doc points to the ToS. — [Replicate docs: safety checking](https://replicate.com/docs/topics/predictions/safety-checking.md)
- Model API schemas show `disable_safety_checker` as a boolean, default false, available via the API only. — [Replicate model API example](https://replicate.com/brettimus/sdxl-pugsly/api)
- I did not retrieve the NSFW wording in Replicate's ToS. (Gap.)

**Together AI**
- Together's ToS makes users "responsible for all of Your Content and Output". — [Together ToS](https://www.together.ai/terms-of-service)
- A search summary said Together's image API has `disable_safety_checker`, which stops rejection of images flagged NSFW, and that it is "Not available for Flux Schnell Free and Flux Pro models". I could not open the primary doc, so treat this as **unverified**. — [AI SDK Together provider page](https://ai-sdk.dev/providers/ai-sdk-providers/togetherai)
- A 2024 academic survey lists Together among developers that "broadly prohibit some types of sexual content". This is older. — [arXiv 2409.09041](https://arxiv.org/html/2409.09041v1)

**Runware**
- Runware's help center (updated 2026-03-08) says it "supports NSFW filtering". Filtering can be switched on in model moderation settings or through API request parameters. The implication is that filtering is opt-in, but the article does not state the default. — [Runware help: NSFW filtering](https://help.runware.ai/articles/5571280435-is-there-a-way-to-filter-out-nsfw-content)
- Runware's restrictions FAQ lists illegal content, deepfakes without disclosure, misleading material and IP infringement. — [Runware restrictions FAQ](https://help.runware.ai/articles/6569725725-are-there-any-restrictions-on-how-i-can-use-runware)

**ModelsLab (formerly stablediffusionapi.com)**
- Requests send `"safety_checker": "no"` with an NSFW model_id. API access needs a paid plan from $21/month, and there is no free NSFW key. — [stablediffusionapi.com NSFW](https://stablediffusionapi.com/models/nsfw)
- Model pages say the API "does not enforce the same NSFW gating as the web playground — content moderation is handled by your account-level policy". This is vendor marketing. — [ModelsLab model page](https://modelslab.com/models/modelslab/10)
- ModelsLab hosts many Civitai-style community checkpoints, including photoreal NSFW ones (e.g., "newrealityxl-global-nsfw"). Aweborn would need to pick models carefully. — [HF stablediffusionapi](https://huggingface.co/stablediffusionapi/newrealityxl-global-nsfw)

**Novita AI**
- Novita's ToS makes CSAM and "non-consensual synthetic intimate imagery or deceptive depictions of real people" absolutely prohibited. The snippet does not say how consensual adult content is treated. — [Novita ToS](https://novita.ai/legal/terms-of-service)

**Stability AI API / weights**
- Stability's AUP has a "We Prohibit Sexually Explicit Content" section covering content relating to sexual intercourse, sexual acts or sexual violence. It also applies to self-hosted weights under Stability's Non-Commercial Research, Community or Enterprise licenses. The page shows an effective date of 2026-09-30 and links to a prior version. — [Stability AUP](https://stability.ai/use-policy)
- Secondary sources date the change to 2025-07-31. — [note.com analysis](https://note.com/tenyou_10800/n/nf45563662b7f?hl=en); [itexplore](https://itexplore.org/columns/stability-ai-rules-end-of-wild-west/)
- Per search snippet, Civitai said SD1.5, SDXL and SDXL-derivative models remain usable for NSFW on its platform. Fetching the page failed with HTTP 403. — [Civitai article 17499](https://civitai.com/articles/17499/update-on-stability-ai-acceptable-use-policy-change)

**Black Forest Labs API (FLUX Pro / FLUX.2)**
- The BFL API exposes `safety_tolerance`. Third-party docs agree on a default of 2 but disagree on the range (0-6, 1-6 or 0-5 depending on endpoint). Max permissiveness is still moderated. — [1min.ai Flux 2 Max](https://docs.1min.ai/docs/api/ai-for-image/image-generator/flux-2-max-image-generation); [bfl-api npm](https://socket.dev/npm/package/bfl-api); [WaveSpeed Kontext](https://doc.wavespeed.ai/docs-api/flux-kontext-pro-text-to-image)
- BFL's own usage policy was not retrieved. A secondary guide says it requires documented consent for intimate depictions of real people. — [glbgpt](https://www.glbgpt.com/hub/how-to-use-flux-to-generate-nsfw/)

**xAI (Grok Imagine)**
- xAI lists grok-imagine-image at $0.02 per image (1K/2K). grok-imagine-image-2.0 is reported from $0.04 per image at 1K. — [xAI Imagine API](https://x.ai/api/imagine); [OpenRouter Grok Imagine Image 2.0](https://openrouter.ai/x-ai/grok-imagine-image-2.0)
- Secondary sources say the API has no documented adult-content tier or safety-disable field and follows the same AUP. Consumer "spicy" settings do not carry over. — [yingtu.ai](https://yingtu.ai/en/blog/grok-imagine-adult-content-guide); [aifreeapi](https://www.aifreeapi.com/en/posts/grok-imagine-adult-content)

**Leonardo.ai**
- Sources conflict. Some say NSFW can be enabled on paid plans. Others describe strict SFW filtering by default and over-blocking. Leonardo's official policy was not retrieved. — [aitoolsdevpro](https://aitoolsdevpro.com/ai-tools/leonardo-ai-guide/); [aitoolsforkids](https://www.aitoolsforkids.com/blog/leonardo-ai-for-kids); [airespo](https://airespo.com/questions/how-restrictive-is-leonardo-ai/)

**NovelAI**
- NovelAI's "Full" model can generate NSFW anime images. The "Curated" model is designed to prevent NSFW. — [NovelAI Wikipedia](https://en.wikipedia.org/wiki/NovelAI); [NamuWiki guide](https://en.namu.wiki/w/NovelAI/%EC%9D%B4%EB%AF%B8%EC%A7%80%20%EC%A0%9C%EB%84%A4%EB%A0%88%EC%9D%B4%ED%84%B0/%EA%B0%80%EC%9D%B4%EB%93%9C)
- API use is unofficial and subscription-based. Community SDKs say all API users must follow the NovelAI ToS. — [novelai-python PyPI](https://pypi.org/project/novelai-python/); [request script gist](https://gist.github.com/MinusGix/c1be5475a0fc79c56439c59976bec290)

**OpenRouter**
- OpenRouter's image catalog includes Microsoft MAI-Image (2.5, 2.5 Pro, 2.6, 2.6 Flash), Google, OpenAI, BFL, xAI, ByteDance, Recraft and Krea. — [OpenRouter image benchmarks](https://openrouter.ai/benchmarks/media/images); [OpenRouter image model guide](https://openrouter.ai/blog/tutorials/image-generation-models/)
- OpenRouter's ZDR setting routes only to endpoints with a ZDR policy. It is set in account privacy settings, not the image API provider object. — [OpenRouter data collection](https://openrouter.ai/docs/guides/privacy/data-collection)

### Inferences
- Among hosted options, the realistic adult-capable paths are fal, Replicate, Runware, ModelsLab and possibly Together. Each would run an open-weight anime/stylized checkpoint with the checker off and Aweborn's own moderation on top. Each stays subject to vaguely worded AUPs. Aweborn should get written confirmation of its use case (fictional, stylized, adult-only, pre-moderated) to lower ban risk.
- OpenRouter's catalog is almost entirely closed first-party models (Google, OpenAI, MAI, BFL, xAI), and these are unlikely to permit explicit content. Moving adult generation off MAI/OpenRouter therefore probably means a second provider.
- Stability's API and the SD3.x weights are effectively ruled out for explicit content.

### Gaps
- Primary policy text not retrieved for Together AUP, Replicate ToS NSFW clause, BFL usage policy, xAI AUP, Fireworks, DeepInfra, Civitai generation API, NovelAI ToS, and Leonardo.
- Fireworks and DeepInfra: no information found.
- Civitai's generation API (Orchestration) terms after the 2025 changes: not found.
- No documented cases found of fal, Replicate or Runware banning accounts specifically for fictional adult content.

## Q2. Open-weight models for stylized/anime/painterly work and their licenses

### Takeaway
The SDXL anime family (Illustrious, NoobAI, Pony) is still the strongest stylized-NSFW ecosystem, but its licenses are messy Fair-AI-Public-License derivatives with commercial-service limits. For clean licenses, Chroma (Apache 2.0, FLUX-schnell based, uncensored), FLUX.2 [klein] 4B (Apache 2.0) and the original Qwen-Image (Apache 2.0) stand out. FLUX.1/FLUX.2 [dev] and [klein] 9B are non-commercial.

### Cited Findings
- FLUX.2 [klein] 4B and 4B Base are Apache 2.0. FLUX.2 [klein] 9B and FLUX.2 [dev] use the FLUX Non-Commercial License. The official inference repo "includes filters for NSFW and protected content in inputs and outputs". That is a code feature, not a license term. — [HF FLUX.2-klein-4B](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B); [GitHub flux2](https://github.com/black-forest-labs/flux2); [VentureBeat](https://venturebeat.com/technology/black-forest-labs-launches-open-source-flux-2-klein-to-generate-ai-images-in)
- Wikipedia and innfactory mention newer "FLUX 3"/Klein 3 models under a "Flux Kommunity License" that limits commercial output use to companies under $5M revenue. **Low confidence; not verified.** — [Wikipedia Flux](https://en.wikipedia.org/wiki/Flux_(text-to-image_model)); [innfactory](https://innfactory.ai/en/ai-models/flux/)
- Runware lists FLUX 3 Image from $0.041 per image. — [Runware blog](https://runware.ai/blog/flux-3-image-four-generations)
- Chroma (lodestones) is an 8.9B model based on FLUX.1-schnell, Apache 2.0, billed as "Open-Source, Uncensored". — [HF Chroma README](https://huggingface.co/lodestones/Chroma/blob/2daa38693a04d1b4936efe558246f84a9ac6cc73/README.md); [Civitai Chroma post](https://civitai.com/posts/13766416)
- Qwen-Image and Qwen-Image-2512 are Apache 2.0. A blog says Qwen-Image-2.1 moved to a non-commercial Qwen Research License. **Unverified.** — [HF Qwen-Image](https://huggingface.co/Qwen/Qwen-Image); [spicyapi blog](https://spicyapi.ai/blog/qwen-image-2-1-lora-open-weights-nsfw)
- HiDream-O1-Image is listed as MIT. Its censorship status was not found. — [pinggy](https://pinggy.io/blog/best_free_open_source_ai_image_generators_to_self_host/)
- Pony Diffusion V6 XL uses a modified Fair AI Public License 1.0-SD, with commercial inference granted to Civitai and HF. — [HF Pony V6 XL](https://huggingface.co/LyliaEngine/Pony_Diffusion_V6_XL)
- Pony V7 is reportedly free for individuals and businesses under $1M revenue, with others using a paid API via fal. **Unverified secondary source.** — [aiofm.info](https://aiofm.info/en/guides/pony-vs-illustrious)
- Illustrious XL's license is reported inconsistently: an "sdxl-license" HF tag in one place, Fair AI Public License 1.0-SD in another. Under FAIPL-1.0-SD, outputs can be commercial but the model "cannot be used for money-making services". — [aiofm Illustrious vs NoobAI](https://aiofm.info/en/compare/illustrious-vs-noobai-xl); [localaimaster](https://localaimaster.com/blog/best-local-anime-image-model)
- Reports on NoobAI XL's license conflict. One says a modified FAIPL-1.0-SD prohibits commercial use of outputs; another lists commercial use as yes. — [aiofm Pony vs NoobAI](https://aiofm.info/en/guides/pony-vs-noobai); [aiofm compare](https://aiofm.info/en/compare/illustrious-vs-noobai-xl)
- Pony has the most NSFW LoRAs. NoobAI adds e621/furry tag coverage on top of Illustrious, which is relevant to Aweborn's fantasy creatures. — [aiofm](https://aiofm.info/en/guides/pony-vs-illustrious)
- Stability's AUP banning sexually explicit content covers weights under Stability's Community and Enterprise licenses (SD3/3.5 class). — [Stability AUP](https://stability.ai/use-policy)

### Inferences
- From memory, not re-verified here: SDXL 1.0 base uses CreativeML OpenRAIL++-M, not the Stability Community License. Illustrious, NoobAI and Pony inherit from it. Whether the 2025 Stability AUP reaches SDXL derivatives is contested. Verify with counsel.
- Aweborn is a nonprofit, but it runs a public service. "No money-making service" clauses (FAIPL) and "non-commercial" clauses (FLUX dev) need legal review. A free nonprofit service is not automatically "non-commercial" under these licenses.
- Lowest license risk for stylized adult content: Chroma or FLUX.2 klein 4B (Apache) plus style LoRAs. Best quality and tag control for anime: Illustrious/NoobAI, with license risk attached.

### Gaps
- Exact current license texts for Illustrious v1/v2/v3.5, NoobAI, Pony V7, Qwen-Image 2.x, HiDream, and Z-Image were not fetched.
- No evaluation found comparing stylized NSFW quality of Chroma vs Illustrious.

## Q3. Enforcing "stylized only"

### Takeaway
I found no off-the-shelf photo-vs-illustration classifier. CLIP-embedding heads (city96 AnimeClassifiers, CityAesthetics) are the best starting point. A small logistic-regression or MLP head on CLIP ViT-L/14 embeddings is cheap to train. Combine this with anime-only checkpoints, style LoRAs and forced style prompt tokens.

### Cited Findings
- city96 AnimeClassifiers are CLIP ViT-L/14 embeddings with small heads that predict concepts. They tile images at inference because of CLIP's 224-336px resolution. — [HF city96/AnimeClassifiers](https://huggingface.co/city96/AnimeClassifiers)
- city96 CityAesthetics is deliberately "Completely negative towards real life photos (ideal score of 0%)", so it can serve as a photoreal signal. — [HF CityAesthetics](https://huggingface.co/city96/CityAesthetics/blame/main/README.md)
- waifu-diffusion aesthetic (CLIP B/32 plus MLP) scores anime images 0-1. — [GitHub aria1th/aesthetic](https://github.com/aria1th/aesthetic); [cafe_aesthetic](https://huggingface.co/cafeai/cafe_aesthetic)
- On the Replicate API, disabling the checker is explicitly meant to let you plug in your own safety model. — [Replicate docs](https://replicate.com/docs/topics/predictions/safety-checking.md)

### Inferences
- Layered approach: (1) Use base checkpoints that are inherently non-photoreal (Illustrious/NoobAI/Pony are booru-trained). Avoid "realistic" merges. (2) Server-side prompt rewriting that always prepends style tokens and adds "photo, photorealistic, realistic" to the negative prompt, with no user override. (3) A post-generation CLIP photoreal score with a hard threshold. (4) Existing age, likeness and CSAM checks.

### Gaps
- No published benchmark found for photoreal-vs-stylized classification accuracy on AI-generated art.

## Q4. Prices, latency, retention, nonprofit programs

### Takeaway
Open-weight hosting is far cheaper than MAI's ~$0.02 per image. Runware FLUX schnell starts at $0.0006, SDXL on Runware is reportedly ~$0.002-0.003, and xAI is $0.02. I found no retention or nonprofit-program details for the adult-capable hosts.

### Cited Findings
- Runware FLUX.1 [schnell]: $0.0006 per image, with a second configuration at $0.0013. Prices vary by resolution and steps. — [Runware FLUX schnell](https://runware.ai/models/bfl-flux-1-schnell); [Runware pricing](https://runware.ai/pricing)
- Runware SDXL: reported as $0.0026 or $0.0019, and FLUX Dev as $0.0038 (third-party, unverified). — [composio](https://composio.dev/content/best-fal-ai-alternatives); [techsifted](https://www.techsifted.com/posts/flux-ai-pricing-2026/)
- ModelsLab NSFW API plans start at $21/month. — [stablediffusionapi.com](https://stablediffusionapi.com/models/nsfw)
- xAI grok-imagine-image: $0.02 per image. — [xAI](https://x.ai/api/imagine)
- One source says grok-imagine-image-quality retires 2026-11-02 (unverified). — [unifically](https://unifically.com/blogs/grok-imagine-api-pricing)
- fal's Trust & Safety page links to a DPA and Privacy Policy but states no retention terms. — [fal Trust & Safety](https://fal.ai/legal/trust-and-safety)

### Gaps
- Data retention and training-on-data terms for fal, Replicate, Runware, Together, ModelsLab, Novita and NovelAI were not found. This is critical for Aweborn's ZDR requirement.
- Nonprofit or discount programs at any of these providers: none found.
- Latency for hosted endpoints: not found. See Q5 for GPU throughput.

## Q5. Self-hosting cost

### Takeaway
On an RTX 4090 rented from RunPod, cost at full utilization is roughly $0.0003-0.0005 per image for SDXL and $0.0009-0.002 for FLUX dev. Self-hosting also gives full control over retention and moderation. Real costs depend on idle time and cold starts.

### Cited Findings
- Benchmarks (May 19, 2026) at 1024x1024 on an RTX 4090: SDXL 20 steps at 2.6 s/image, FLUX Schnell 4 steps at ~4.5 s, FLUX Dev 20 steps FP8 at 10 s. RunPod 4090 rents for $0.34/hr (Community) or $0.69/hr (Secure). Derived cost per image: SDXL ~$0.00025-0.0005, Schnell ~$0.00043-0.00086, Dev ~$0.00094-0.0019. This assumes 100% utilization. — [runaihome cost per image 2026](https://runaihome.com/blog/flux-vs-sdxl-vs-sd15-cost-per-image-2026/)
- Vast.ai is listed "from $0.07/hr", GPU unspecified. — [same](https://runaihome.com/blog/flux-vs-sdxl-vs-sd15-cost-per-image-2026/)

### Inferences
- Even at 20% utilization, self-hosted SDXL comes to about $0.0025 per image, roughly 8x cheaper than MAI. Serverless options (RunPod Serverless, Modal) trade a higher per-second price for no idle cost.
- Self-hosting also avoids third-party AUP and ban risk. Aweborn then carries full responsibility for CSAM detection and NCMEC reporting.

### Gaps
- Modal, H100, A100 and L4 per-image figures: not found.

## Q6. 2025-2026 incidents relevant to risk

### Takeaway
Grok's "spicy" mode and the "undress" trend set off a global regulatory pile-on in 2026 (EU, France, UK ICO/Ofcom, California AG, Australia, Canada), plus a class action. Civitai lost card processing in May 2025 for keeping NSFW content and banned real-person content. The lesson: payment processors and regulators focus on real-person likeness and minors, which Aweborn already checks for.

### Cited Findings
- Grok Imagine launched in August 2025 with a paid "Spicy Mode". By December 2025, users were asking Grok to "undress" women in photos without consent. — [creati.ai](https://creatiai-frontend-prod.pages.dev/ai-news/2026-01-26/grok-ai-deepfake-backlash-regulatory-investigation-2026/); [Fortune 2026-01-06](https://fortune.com/2026/01/06/elon-musks-grok-chatbot-deepfakes-nude-images-women-children/)
- The European Commission said it was "very seriously looking into this matter". — [Fortune](https://fortune.com/2026/01/06/elon-musks-grok-chatbot-deepfakes-nude-images-women-children/)
- French prosecutors summoned Musk, and the case expanded in January 2026. — [babel.ua](https://babel.ua/en/news/126375-french-prosecutors-summon-musk-for-questioning-in-x-sexualized-deepfakes-generated-by-grok-chatbot)
- The California AG opened an investigation into xAI. A reported cease-and-desist dated 2026-01-14 is unverified. — [The Record](https://therecord.media/california-grok-deepfakes-investigation); [Gigazine](https://gigazine.net/gsc_news/en/20260117-grok-still-allow-sexualised-images-cease-and-desist-order)
- The UK ICO opened a formal investigation on 2026-02-03, with Ofcom running a parallel probe. Australia's eSafety also investigated. — [intelligibberish](https://intelligibberish.pages.dev/articles/2026-02-26-grok-deepfake-scandal-global-regulators-crackdown); [IBTimes](https://www.ibtimes.co.uk/regulators-sound-alarm-grok-ai-deepfakes-one-sexualised-image-child-every-60-seconds-1769179)
- WIRED found Grok Imagine still hosting nonconsensual sexual deepfakes. — [aidirectory summary](https://aidirectory.com/news/wired-finds-grok-imagine-hosting-nonconsensual-sexual-deepfakes)
- Consumer groups asked the FTC to probe spicy mode. — [feedbagel](https://feedbagel.com/post/consumer-groups-demand-ftc-probe-into-grok-ais-spicy-mode-over-deepfake-concerns)
- Reports of a March 2026 class action, Canadian privacy findings, and a $530M SpaceX reserve are secondhand and unverified. — [lenz.io](https://lenz.io/q/grok-ai-sexualized-deepfake-images)
- Civitai: its card processor terminated service on May 23, 2025 "because we chose not to remove NSFW and adult content". Civitai moved to crypto (NowPayments) and a high-risk processor. — [Decrypt](https://decrypt.co/322197/civitai-crypto-credit-card-processor-ban-ai-explicit-content)
- Civitai banned real-people content under pressure from Mastercard and Visa and new laws. It also bans incest, self-harm, diapers and similar categories. — [404 Media](https://404media.co/civitai-ban-of-real-people-content-deals-major-blow-to-the-nonconsensual-ai-porn-ecosystem); [Unite.AI](https://www.unite.ai/civitai-tightens-deepfake-rules-under-pressure-from-mastercard-and-visa); [Forklog](https://forklog.com/en/?p=23609)
- Unite.AI linked Civitai's new payment crisis to the Take It Down Act being signed. — [Unite.AI](https://www.unite.ai/civitai-in-new-payment-provider-crisis-as-trump-signs-anti-deepfake-act)
- A May 2025 Trump signature on the anti-deepfake (Take It Down) Act is referenced there. — [Unite.AI](https://www.unite.ai/civitai-in-new-payment-provider-crisis-as-trump-signs-anti-deepfake-act)
- Regulators internationally are drawing lines on AI explicit imagery (law-firm commentary). — [Baker Botts](https://ourtake.bakerbotts.com/post/102m1oa/international-regulators-draw-the-line-on-ai-generated-explicit-imagery)

### Inferences
- If Aweborn takes donations by card, the Civitai precedent shows processors may act against hosting explicit content even when it is legal. A 501(c)(3) should check its payment processor and donation platform terms.
- Choosing xAI as a provider carries reputational risk regardless of its terms.

### Gaps
- Final outcomes of the Grok investigations as of Nov 2026: not found.
- Any UK or Online Safety Act block on Civitai: not confirmed.
