# Registry seed review

The product and model JSON in `data/registry/` is an **illustrative seed**,
not a researched market survey.

Before treating any row as a public recommendation:

1. Confirm the product still exists and the URL is canonical.
2. Replace `evidence_url` with a dated primary source (docs, pricing, changelog).
3. Set `evidence_date` to that source’s date (`YYYY-MM-DD`).
4. Keep `evidence_notes` to one factual sentence.
5. Re-run `myai freshness` and `myai score`.

Last full pass: 2026-09-16. Added DeepSeek, Grok, Microsoft Copilot, Meta AI, GitHub Copilot, LM Studio, and Mistral Le Chat (products 0.4) plus Qwen 3, DeepSeek-R1, Llama 3.1, Gemma 3, and gpt-oss 20B (models 0.4), each with a dated official source. Re-run this checklist when a vendor ships a material change.
