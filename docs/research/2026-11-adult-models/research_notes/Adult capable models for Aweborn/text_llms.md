# Adult-capable text LLMs and providers for Aweborn (via OpenRouter), as of Nov 2026

Research date: 2026-11-07. Live OpenRouter data was pulled that day from the public API endpoints `https://openrouter.ai/api/v1/models` (460 models) and `https://openrouter.ai/api/v1/endpoints/zdr` (1,120 ZDR endpoints). Prices and ZDR lists change often, so re-pull them before you rely on any number here. Several policy pages (x.ai, openai.com) returned HTTP 403 to the fetcher. Where these notes rely on secondary sources, they say so.

## 1. OpenRouter's own content policy, provider pass-through, and moderation

### Takeaway
OpenRouter's Terms (last updated Aug 31, 2026) have no clause on sexual or adult content as such. They require users to be 18+, ban unlawful content and CSAM, and require compliance with each model's or provider's terms ("Model Terms"). Moderation is per model. Anthropic and OpenAI endpoints show `is_moderated: true`, which means OpenRouter runs its own filter in front of them. Open-weight, xAI, Google and Mistral endpoints mostly show `false`. From Oct 27, 2026, OpenRouter screens all inference for CSAM, including ZDR traffic, and may keep flagged items.

### Cited Findings
- The Terms' last-updated date is August 31, 2026. They contain no provision specifically about sexual, adult or NSFW content. — [OpenRouter Terms](https://openrouter.ai/terms)
- Age: "You must be at least 18 years of age to use the Service" (Sec. 2). — [OpenRouter Terms](https://openrouter.ai/terms)
- Pass-through: users must "comply with the applicable terms for each Model" (Sec. 5.1). The customer is "responsible for all acts and omissions of your Authorized Users, including any violation of applicable Model Terms" (Sec. 5.2). OpenRouter "may suspend, restrict, disable, or terminate" access to a model if a user may violate its Model Terms, or if the Model Provider asks it to (Sec. 5.5). — [OpenRouter Terms](https://openrouter.ai/terms)
- Prohibited: content that is "unlawful" or that breaches the terms of the relevant Model or Provider (Sec. 7(8)). Also banned: uploads containing "child sexual abuse material (CSAM) or otherwise exploits or endangers minors" (Sec. 6.9(a), 7(9)). — [OpenRouter Terms](https://openrouter.ai/terms)
- OpenRouter may "screen, remove, edit, or block any Inputs" at any time without notice. This "includes screening Inputs for known child sexual abuse material (CSAM) ... using automated detection tools" (Sec. 6.7). — [OpenRouter Terms](https://openrouter.ai/terms)
- CSAM screening covers ZDR traffic too. An update dated October 27, 2026 screens all inference requests, including ZDR traffic. "Content flagged as potential CSAM may be retained for human review, reporting, and preservation where required by law." OpenRouter says this does not allow general retention or training use. — [OpenRouter ZDR docs](https://openrouter.ai/docs/features/zdr)
- In the live API, `top_provider.is_moderated` was `true` for Anthropic Claude models (e.g., `anthropic/claude-sonnet-5.5`, `claude-opus-5.5`, `claude-haiku-5.5`) and for most OpenAI GPT-5.x models. It was `false` for xAI Grok 4.x, Google Gemini 3.x, Mistral, DeepSeek, GLM, Kimi, Qwen, and community RP finetunes. A few exceptions in the data look like a different top provider was selected (e.g., `anthropic/claude-opus-4.8` showed `false`; `~x-ai/grok-latest` showed `true`). — [OpenRouter models API](https://openrouter.ai/api/v1/models) (pulled 2026-11-07)
- OpenRouter's "self-moderated" variant is the `:beta` suffix. It lets the model apply its own filtering instead of an external moderation layer. The variant doc URL now returns 404, so the variant may be retired. — [search snippet of OpenRouter docs](https://openrouter.ai/docs/features/variants/self-moderated) (404 when fetched 2026-11-07; status uncertain)
- Moderation blocks reportedly come back as `403` errors with metadata: reasons, flagged_input, provider_name, model_slug. — [DevelopersDigest (secondary)](https://www.developersdigest.tech/errors/api/openrouter/403-content-policy-violation)
- Third-party NSFW guides describe OpenRouter as permissive: it "routes to models that allow it". These guides are not authoritative. — [waifustack](https://waifustack.pages.dev/posts/choosing-the-right-llm-api-for-adult-content); [NovelCrafter help](https://novelcrafter.com/help/docs/ai/nsfw-models)

### Inferences
- OpenRouter itself does not forbid consensual adult sexual fiction. The binding limits are (a) legality, (b) CSAM/minors, and (c) each upstream provider's AUP, which OpenRouter can enforce by suspending model access.
- For adult worlds, Aweborn should exclude `is_moderated: true` endpoints (Anthropic, most OpenAI) from adult routing. Those requests will get refused or 403-blocked, and they break the upstream AUPs anyway.
- CSAM screening of ZDR traffic means the account's ZDR posture has a carve-out. Aweborn's privacy disclosures should mention it.

### Gaps
- No current OpenRouter doc page states which models are "moderated" or what classifier OpenRouter uses. The self-moderated (`:beta`) doc is gone (404).
- No public OpenRouter statement says whether it bans accounts for lawful adult content on non-moderated endpoints.

## 2. Which upstream providers permit or forbid explicit adult sexual content

### Takeaway
**Forbid:** Anthropic forbids it outright (AUP effective Nov 12, 2026: no sex acts, no fetish content, no "erotic chats"). OpenAI's API still defaults to no erotica. ChatGPT's "adult mode" was delayed in Mar 2026 and apparently never launched; only weak sources say anything for Sep–Oct 2026.
**Silent on adult fiction, ban CSAM and real-person/non-consensual content:** xAI (AUP of Aug 14, 2026, per a secondary source), Mistral (Usage Policy of Jun 11, 2026), and Meta Llama 4's AUP.
**Market themselves as uncensored or RP-oriented (official terms not retrieved):** Venice, Mancer, Parasail-hosted TheDrummer models, and community finetunes.

### Cited Findings
**Anthropic (forbids)**
- AUP effective November 12, 2026: users may not "Depict or request sexual intercourse or sex acts", "Generate content related to sexual fetishes or fantasies", or "Engage in erotic chats". The AUP also bars sexualizing minors "including in fictional settings or via roleplay", and defines a minor as anyone under 18 "regardless of jurisdiction". — [Anthropic AUP](https://www.anthropic.com/legal/aup)

**OpenAI (forbids by default; adult mode delayed)**
- Oct 2025: Altman said erotica for verified adults would come in December 2025. It was later pushed to Q1 2026, and Fidji Simo said she expected adult mode in Q1 2026. — [Decrypt](https://decrypt.co/352189/sorry-gooners-openai-erotic-chatgpt-delayed-2026?amp=1); [Gizmochina](https://www.gizmochina.com/2025/12/14/chatgpt-adult-mode-launch-2026-age-verification/)
- Jan 2026: OpenAI rolled out age prediction globally and may use third-party government-ID checks. — [Business Today](https://www.businesstoday.in/technology/news/story/openai-brings-age-verification-to-chatgpt-as-it-prepares-for-adult-content-access-all-details-511984-2026-01-21)
- Early Mar 2026: an OpenAI spokesperson told Axios it was "pushing out the launch of adult mode" to focus on other priorities. — [TechCrunch, 2026-03-07](https://techcrunch.com/2026/03/07/openai-delays-chatgpts-adult-mode-again/); [TechRadar](https://www.techradar.com/ai-platforms-assistants/chatgpt/chatgpt-has-delayed-the-roll-out-of-its-adult-mode-again-getting-the-experience-right-will-take-more-time)
- Blogs from Sep–Oct 2026 say there was still no adult mode as of Oct 5, 2026. They also say the Model Spec dated Aug 18, 2026 still tells ChatGPT not to generate erotica. These are weak sources. — [justainews](https://justainews.com/companies/openai/adult-mode-in-chatgpt-explained-nsfw-erotica-porn-policy/); [umesh-malik](https://umesh-malik.com/blog/chatgpt-adult-mode-delay-guide). A Mar 26, 2026 Pulse headline says "OpenAI Lifts Ban on Erotica in ChatGPT", which conflicts with these. — [Pulse (unverified)](https://www.pulse.bot/legaltech/news/openai-lifts-ban-on-erotica-in-chatgpt-sparking-legalcompliance-alarm-in-adultcontent-sector-6d071d27-8769-4a11-9988-8b1d56fcdb7e)
- OpenAI's usage policies page reportedly shows an effective date of Nov 20, 2026, after today, so a new version is pending. A third-party tracker says "operators may enable adult content for appropriate platforms with appropriate safeguards", but its own clause on this is now marked "no longer published" or unverifiable. — [OpenAI usage policies](https://openai.com/policies/usage-policies/) (403 to fetcher); [ConductAtlas](https://conductatlas.com/platform/openai/openai-usage-policies/restrictions-on-sexual-and-adult-content/)
- On OpenRouter, OpenAI models are mostly `is_moderated: true`. — [OpenRouter models API](https://openrouter.ai/api/v1/models)

**xAI / Grok (no explicit ban on adult fiction; strict on real people and minors)**
- xAI's AUP page returned 403 to the fetcher. A secondary explainer says the current AUP took effect Aug 14, 2026, replacing a Jun 26, 2026 version. It bans "undressing or nudifying real people", "Depicting real people pornographically, defamatorily or in a false light" (consent does not cure this), and "Sexualising or exploiting children". The ban on real people pornographically is the part that matters for real-person content. It describes the sexual-content prohibitions as targeting real people and minors, not fiction in general. API use falls under enterprise terms with an 18+ minimum. — [Grokified (secondary)](https://grokified.com/blog/grok-api-acceptable-use-policy); primary: [x.ai AUP](https://x.ai/legal/acceptable-use-policy)
- Other secondary sources conflict. Some say "Spicy" mode stops at suggestive content and partial nudity, not explicit acts; that applies mainly to the consumer app and images. Also, xAI does not publish a list of permitted adult content. — [mangomindbd](https://www.mangomindbd.com/blog/grok-spicy-generations-guide); [aiinsightsnews](https://aiinsightsnews.net/grok-ai-nsfw/)
- OpenRouter's ZDR settings name a "SpaceXAI" model group alongside Anthropic, OpenAI and Google. This suggests a corporate rebrand or merger of xAI; not verified. — [OpenRouter ZDR docs](https://openrouter.ai/docs/features/zdr)

**Mistral (silent on adult content)**
- Usage Policy effective June 11, 2026: "Any generation or attempt to generate CSAM ... is strictly prohibited". Violations are reported to law enforcement and the account is terminated. The policy also bans generating "intimate images of any person without the explicit consent of all individuals involved" and content that "enables or exploits individuals, including through human trafficking or sexual services". It does not address adult sexual text in general. — [Mistral Usage Policy](https://legal.mistral.ai/terms/usage-policy)

**Venice (markets "uncensored")**
- Venice's API docs describe its models as uncensored. Developers can turn off Venice's default system prompt via `venice_parameters`. Response headers flag content that violates Venice's "adult-model content policies", so an adult content policy exists. — [Venice API reference](https://docs.venice.ai/api-reference)
- Per a parental-safety guide, Venice's consumer terms set a 13+ minimum with parental consent, without a technical age check. This is secondary and applies to the consumer product. — [AirDroid](https://airdroid.com/parent-control/is-venice-ai-safe/)

**Google:** Gemini 3.x endpoints on OpenRouter are `is_moderated: false`. — [OpenRouter models API](https://openrouter.ai/api/v1/models). Google's Generative AI Prohibited Use Policy was not retrieved; see Gaps.

### Inferences
- Lowest policy risk for adult text: open-weight models (DeepSeek, GLM, Kimi, Qwen, Mistral-family, Llama finetunes) on hosts with no sexual-content ban, plus Mistral first-party. xAI is a probable but unconfirmed option for adult fiction.
- Anthropic and OpenAI models should be marked "not for 18+ sexual use" in Aweborn's public menu, or routed only for non-sexual tasks such as world planning and lore. Their AUPs bind Aweborn even through OpenRouter (OpenRouter Terms Sec. 5.1).
- Every permissive provider found here bans real-person sexual content and minors. That matches Aweborn's hard lines.

### Gaps
- Not retrieved or verified (fetch blocked, or the search found nothing): the current AUPs or ToS of DeepInfra, Together, Fireworks, Novita, Chutes, Parasail, Mancer, Infermatic, Featherless, NovelAI, Google (Gemini API Prohibited Use Policy), Z.AI, Moonshot, DeepSeek. Their stance on adult sexual text is unconfirmed here, so verify each before publishing a menu.
- xAI's AUP primary text was not readable (403).
- OpenAI's Nov 20, 2026 policy text and the true status of adult mode are unconfirmed. No primary OpenAI announcement of a launch was found.
- Chutes and Infermatic did not appear among the ZDR providers in the live data. Whether they are still on OpenRouter was not checked.

## 3. Open-weight models and finetunes used for adult roleplay, and their licenses

### Takeaway
OpenRouter still lists many community RP finetunes: TheDrummer (Cydonia 24B, Skyfall 36B, UnslopNemo 12B), Sao10K (Euryale 70B, Lunaris 8B), Anthracite Magnum v4 72B, Gryphe MythoMax 13B, Undi95 ReMM, Mancer Weaver, NousResearch Hermes 4 405B, Dolphin-Mistral-24B Venice Edition, and AionLabs Aion-RP. Larger general open models (DeepSeek V4.x, GLM-5.x, Kimi K3, Qwen 3.5) are also widely available. Llama 4's AUP bans child exploitation, "sexual solicitation", and distributing obscene materials *to minors*. It does not mention consensual adult fiction.

### Cited Findings
- Llama 4 AUP Sec. 1.a prohibits "Exploitation or harm to children, including the solicitation, creation" of child exploitative content, and "failure to report Child Sexual Abuse Material". It also prohibits "Human trafficking, exploitation, and sexual violence" and "The illegal distribution of information or materials to minors, including obscene materials", including failure to use legally required age-gating. "Sexual solicitation" is prohibited too. The AUP does not mention fiction, adult consent, or sexual content in general. — [Meta Llama 4 Use Policy](https://dev.meta.ai/llama/llama4/use-policy/)
- RP and adult-oriented models live on OpenRouter on 2026-11-07, with prompt/completion price per 1M tokens and ZDR-eligible providers. — [OpenRouter models API](https://openrouter.ai/api/v1/models); [ZDR endpoints API](https://openrouter.ai/api/v1/endpoints/zdr)

| Model (OpenRouter id) | Base | $/M in | $/M out | Context | ZDR providers |
|---|---|---|---|---|---|
| thedrummer/cydonia-24b-v4.1 | Mistral Small 24B | 0.30 | 0.50 | 131k | Parasail |
| thedrummer/skyfall-36b-v2 | Mistral-based | 0.55 | 0.80 | 32k | Parasail |
| thedrummer/unslopnemo-12b | Mistral Nemo | 0.40 | 0.40 | listed 1.02M | Parasail |
| sao10k/l3.1-euryale-70b | Llama 3.1 70B | 0.85 | 0.85 | 131k | DeepInfra |
| sao10k/l3-lunaris-8b | Llama 3 8B | 0.04 | 0.05 | 8k | DeepInfra, Parasail |
| anthracite-org/magnum-v4-72b | Qwen2.5 72B | 2.50 | 5.00 | 32k | Mancer 2 |
| gryphe/mythomax-l2-13b | Llama 2 13B | 0.08 | 0.11 | 8k | Mancer 2, Parasail |
| undi95/remm-slerp-l2-13b | Llama 2 13B | 0.35 | 0.65 | 6k | Mancer 2 |
| mancer/weaver | Llama 2 (Mancer) | 0.40 | 0.75 | 8k | Mancer 2 |
| nousresearch/hermes-4-405b | Llama 3.1 405B | 1.00 | 3.00 | 131k | Nebius |
| cognitivecomputations/dolphin-mistral-24b-venice-edition | Mistral 24B | 0.20 | 0.90 | 128k | Venice |
| aion-labs/aion-rp-llama-3.1-8b | Llama 3.1 8B | 0.80 | 1.60 | 32k | none |

(The "Base" column comes from model names and general knowledge, not from fetched model cards.)

### Inferences
- Llama-based finetunes (Euryale, Lunaris, Hermes 4, MythoMax, Weaver) inherit the Llama license and AUP. Adult fiction for verified 18+ users does not appear to be banned. The "obscene materials to minors / age-gating" clause makes Aweborn's 18+ gate relevant to compliance.
- Many classic RP finetunes are old (Llama 2/3 era, 6k–32k context). Newer general models (DeepSeek V4.1 Flash, GLM-5.3, Kimi K3) are cheaper or larger-context, and many hosts serve them under ZDR. Whether they write explicit content willingly was not tested here.

### Gaps
- Hugging Face model cards and licenses for each finetune were not fetched. Several Mistral-based finetunes carry Mistral Research or Apache licenses, and Qwen-based ones carry Qwen or Apache licenses; verify per model.
- The licenses of DeepSeek, GLM, Kimi and Qwen 3.5 (usage restrictions on sexual content) were not retrieved.
- There is no source-backed ranking of which models are "most used" for adult RP. OpenRouter's app or roleplay rankings were not fetched.

## 4. ZDR support and representative prices on OpenRouter

### Takeaway
ZDR can be enforced per account (globally or per model group) or per request (`provider.zdr: true`). 1,120 endpoints across ~66 providers qualify. ZDR-capable providers for adult-capable models include DeepInfra, Parasail, Novita, Venice, Mancer 2, Together, Fireworks, Nebius, Mistral and xAI; Featherless has only one ZDR endpoint. Anthropic under ZDR is available only via Bedrock or Vertex, and OpenAI only via Azure.

### Cited Findings
- ZDR means "no routine storage of prompts or responses after processing". It is enforced via privacy settings, globally or per model group (Anthropic, OpenAI, Google, SpaceXAI, all other models). Per-request `provider.zdr: true` adds enforcement but cannot turn the account setting off. Guardrails can only be stricter. If OpenRouter can't confirm an endpoint's policy, it assumes the endpoint retains and trains on data. — [OpenRouter ZDR docs](https://openrouter.ai/docs/features/zdr)
- Under ZDR, first-party Anthropic is removed (Bedrock and Vertex remain), and first-party OpenAI is removed (Azure remains). Google AI Studio is removed; Vertex endpoints that use "Safety Retention" are available only if you opt in. Safety Retention endpoints "may keep prompts and responses to detect and investigate abuse" regardless of flagging, and are not trained on. You choose separately for Google and for all other models. — [OpenRouter ZDR docs](https://openrouter.ai/docs/features/zdr); [Provider logging guide](https://openrouter.ai/docs/guides/privacy/provider-logging)
- Implicit in-memory prompt caching does not count as retention. Under ZDR, the web-search and web-fetch tools reject the Firecrawl engine. — [OpenRouter ZDR docs](https://openrouter.ai/docs/features/zdr)
- ZDR endpoint counts by provider (live, 2026-11-07): DeepInfra 121, Azure 98, Google 88, Amazon Bedrock 57, Mistral 55, Parasail 49, SiliconFlow 42, Novita 40, Venice 38, BaseTen 28, CoreWeave 23, Fireworks 22, Phala 22, Nebius 21, Together 21, xAI 16, Z.AI 15, Mancer 2 10, Groq 8, Moonshot AI 6, Featherless 1. Chutes and Infermatic were not present. — [OpenRouter ZDR endpoints API](https://openrouter.ai/api/v1/endpoints/zdr)
- Representative prices (OpenRouter list price, $/1M tokens in/out; the "ZDR via" column comes from the ZDR endpoints API, 2026-11-07). — [models API](https://openrouter.ai/api/v1/models); [ZDR endpoints API](https://openrouter.ai/api/v1/endpoints/zdr)
  - deepseek/deepseek-v4.1-flash: 0.051 / 0.567 at the lowest-priced endpoint. Endpoints vary: DeepInfra 0.112/0.336, Mancer 2 0.15/0.50, Novita 0.165/0.66 for the -1017 version, Together 0.30/1.20. ZDR via ~25 providers, including DeepInfra, Mancer 2, Novita, Parasail, Together, Venice, Fireworks.
  - z-ai/glm-5.3: 0.07 / 1.40 at the lowest-priced endpoint; Fireworks 0.98/3.08; Parasail 2.10/6.60. ZDR via ~30 providers, including DeepInfra, Novita, Parasail, Venice, Together, Mistral.
  - z-ai/glm-5.3-flash: 0.15 / 0.50. ZDR via ~31 providers.
  - moonshotai/kimi-k3.1-pro: 2.00 / 10.00. ZDR via DeepInfra, Fireworks, Parasail, Together, Nebius, and others.
  - qwen/qwen3.5-397b-a17b: 0.50 / 3.60. ZDR via DeepInfra, Novita, Parasail, Phala, Venice, DigitalOcean.
  - mistralai/mistral-small-3.2-24b-instruct: 0.075 / 0.20. ZDR via DeepInfra, Mistral, Parasail, Venice.
  - mistralai/mistral-nemo: 0.029 / 0.03. ZDR via DeepInfra, Mistral, Parasail, others.
  - mistralai/mistral-large-4-0: 0.70 / 2.10. ZDR via Mistral.
  - meta-llama/llama-3.3-70b-instruct: 0.59 / 0.79. ZDR via DeepInfra, Parasail, Groq, others.
  - x-ai/grok-4.7: 2.00 / 6.00 (xAI direct 2.20/6.60 in the ZDR list). ZDR via xAI and Amazon Bedrock. x-ai/grok-4.20 costs 1.25 / 2.50 with ZDR via xAI.
  - For comparison (forbid adult content): anthropic/claude-sonnet-5.5 2.00/10.00 and claude-opus-5.5 4.00/20.00, with ZDR via Bedrock or Google; openai/gpt-5.5 5.00/30.00, with ZDR via Azure.
- Some ZDR-list prices look anomalous (e.g., Relace 0.006 in for DeepSeek V4.1 Flash; Wafer 0.006/6.8 for GLM-5.2). They may be promotions or data errors. — [ZDR endpoints API](https://openrouter.ai/api/v1/endpoints/zdr)

### Inferences
- With account-level ZDR on, Aweborn's adult menu can include DeepSeek, GLM, Kimi, Qwen, Mistral and Llama-family models, plus most TheDrummer, Sao10K and Mancer RP finetunes. Exclude `aion-labs/aion-rp-llama-3.1-8b`, which has no ZDR endpoint. Each RP finetune usually has only one ZDR host (Parasail, DeepInfra or Mancer 2), so availability is a single point of failure.
- Representative cost for adult character chat is about $0.05–$0.85 per 1M input tokens for mid-size and RP models, and $2/$6 for Grok.

### Gaps
- The provider-logging table rows (per-provider retention durations) were not readable via fetch. ZDR eligibility above comes from the API, not the table.
- The `safety_retention` field exists in the ZDR data but was not tabulated per provider.

## 5. Direct (non-OpenRouter) adult/NSFW-friendly text APIs

### Takeaway
Many small "uncensored LLM API" vendors exist. Their pages are mostly marketing without visible terms, and the few that state rules still ban minors. Venice is the most substantive of them and is also on OpenRouter with ZDR. Age verification of end users is typically self-declared or pushed onto the integrator.

### Cited Findings
- Small vendors marketing uncensored or NSFW text APIs: Unjailed AI says it enforces "a hard limit on sexual content involving minors". Unfil says it filtered alignment out of its training data and advises customers to "implement your own alignment layer". Chat Data uses an 18+ notice and an age question (self-declared). — [aiunjailed.com](https://aiunjailed.com/); [unfil.ai](https://unfil.ai/); [chat-data.com](https://www.chat-data.com/uncensored-llm); others: [roleplayapi.com](https://roleplayapi.com/), [uncensoredllmapi.com](https://uncensoredllmapi.com/), [nsfwaiapi.com](https://nsfwaiapi.com/)
- Venice API: uncensored models, a removable system prompt, and content-policy response headers for adult models. — [Venice API docs](https://docs.venice.ai/api-reference)
- OpenAI's planned adult content (ChatGPT) depends on age prediction plus possible government-ID checks. That is the model of age verification a major lab would expect. — [Business Today](https://www.businesstoday.in/technology/news/story/openai-brings-age-verification-to-chatgpt-as-it-prepares-for-adult-content-access-all-details-511984-2026-01-21)

### Inferences
- These vendors offer little over OpenRouter's ZDR-eligible open-weight hosts, and they add vendor and continuity risk. Unverified ToS and data-retention terms make them a poor fit for a nonprofit with a ZDR commitment.

### Gaps
- Terms, age-verification requirements and retention policies for NovelAI, Featherless, Infermatic, Mancer (direct), Chutes, and Venice (API ToS) were not retrieved. The searches returned no primary terms.

## 6. Known risks: account bans, CSAM, real people

### Takeaway
The universal lines are CSAM and sexualizing minors (including fiction and roleplay, per Anthropic and xAI), real-person sexual depiction (xAI, Mistral), and non-consensual intimate content. OpenRouter can cut off model access when an upstream provider asks, retains CSAM-flagged content even under ZDR, and holds the customer responsible for its end users.

### Cited Findings
- OpenRouter: the customer is responsible for end-user violations of Model Terms. OpenRouter may suspend model access on a provider's request. — [OpenRouter Terms](https://openrouter.ai/terms)
- OpenRouter screens all inference, including ZDR, for CSAM from Oct 27, 2026, and retains flagged content for review and reporting. — [OpenRouter ZDR docs](https://openrouter.ai/docs/features/zdr)
- Mistral: CSAM attempts lead to account termination and a law-enforcement report. — [Mistral Usage Policy](https://legal.mistral.ai/terms/usage-policy)
- Anthropic: anyone under 18 is a minor "regardless of jurisdiction". Sexualizing minors is banned "including in fictional settings or via roleplay". — [Anthropic AUP](https://www.anthropic.com/legal/aup)
- xAI: bans "Sexualising or exploiting children" and pornographic depiction of real people even with consent (secondary source). — [Grokified](https://grokified.com/blog/grok-api-acceptable-use-policy)
- Llama: requires reporting CSAM and legally required age-gating. — [Meta Llama 4 Use Policy](https://dev.meta.ai/llama/llama4/use-policy/)

### Inferences
- Aweborn's pre-display hard-line checks (minors in any style, real people sexual) line up with these provider rules. Minors "in any style" also covers fictional and stylized minors, which Anthropic's "fictional settings" language explicitly targets.
- Inputs still reach the provider before the check runs: a player's prompt reaches the model and OpenRouter's CSAM scanner before Aweborn checks the output. Input-side filtering would reduce exposure to bans and to CSAM-flag retention.

### Gaps
- No documented 2025–2026 cases were found of OpenRouter or a specific host banning an account for lawful adult content. Absence of evidence is not evidence of absence.
