# AI Fit (consumer)

The public **AI Fit** product — adaptive AI style quiz and setup files. Merged from [aifit-engine](https://github.com/aking-beep/aifit-engine) into the ARK monorepo. It is a separate product from AI Fit Teams and from Control.

- **UI:** this app (`@ark/consumer`, port **3000**)
- **Engine + API:** [`my-ai/`](../../my-ai/) (Python, port **8472** in dev)

```bash
# from repo root
npm run dev:my-ai-api  # terminal 1
npm run dev:consumer   # terminal 2
```
