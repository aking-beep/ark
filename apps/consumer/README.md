# MY AI (consumer)

The public **MY AI** product — adaptive AI style quiz and setup files. Merged from [aifit-engine](https://github.com/aking-beep/aifit-engine) into the ARK monorepo.

- **UI:** this app (`@ark/consumer`, port **3000**)
- **Engine + API:** [`fit/`](../../fit/) (Python, port **8472** in dev)

```bash
# from repo root
npm run dev:fit-api    # terminal 1
npm run dev:consumer   # terminal 2
```

See [`docs/06-aifit-consumer.md`](../../docs/06-aifit-consumer.md) and [`fit/README.md`](../../fit/README.md).
