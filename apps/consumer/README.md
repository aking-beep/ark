# Web App

Create the Next.js application here during Week 3.

Recommended setup:

```bash
npx create-next-app@latest apps/web --ts --eslint --app
```

Pages:

- `/` — hook + methodology disclaimer
- `/assessment` — game flow
- `/results/[sessionId]` — Interaction Signature + AI Stack + Model Match + Persona
- `/methodology` — scoring explanation and limitations

Do not duplicate scoring logic in the browser. Call the API.
