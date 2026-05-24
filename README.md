# bbx-kyc-flow

Web component that embeds the BlackyBox KYC verification flow inside an iframe
and exposes the lifecycle events as standard DOM `CustomEvent`s.

Built with [Lit](https://lit.dev/) · TypeScript · Vite

---

## Installation

```bash
# npm
npm install bbx-kyc-flow

# pnpm
pnpm add bbx-kyc-flow
```

Or load it directly from a CDN/build output:

```html
<script type="module" src="/bbx-kyc-flow.es.js"></script>
```

---

## Quick start

```html
<bbx-kyc-flow
  token="eyJhbGci..."
  kyc-url="https://kyc.myapp.com"
  height="640px"
></bbx-kyc-flow>

<script>
  document.querySelector('bbx-kyc-flow').addEventListener('bbx-kyc-completed', (e) => {
    console.log('KYC completed ✅', e.detail);
  });
</script>
```

---

## Attributes

| Attribute | Type   | Default                 | Description |
|-----------|--------|-------------------------|-------------|
| `token`   | string | `''`                    | **Required.** Session JWT returned by the KYC Sessions API. |
| `kyc-url` | string | `http://localhost:5174` | Base URL of the KYC flow application. |
| `width`   | string | `100%`                  | CSS width of the iframe. Any valid CSS value. |
| `height`  | string | `600px`                 | CSS height of the iframe. Any valid CSS value. |

---

## Public method

```ts
kyc.reload(); // Reloads the iframe without changing the token
```

---

## Events

The component listens to `window.postMessage` messages sent by the KYC app running
inside the iframe, and re-dispatches them as DOM `CustomEvent`s with
`bubbles: true` and `composed: true` (they cross the Shadow DOM boundary).

### Event table

| DOM Event                     | iframe `postMessage` type  | `event.detail` shape |
|-------------------------------|----------------------------|----------------------|
| `bbx-kyc-started`             | `KYC_STARTED`              | `{ sessionId: string }` |
| `bbx-kyc-completed`           | `KYC_COMPLETED`            | `{ sessionId: string, status: string }` |
| `bbx-kyc-rejected`            | `KYC_REJECTED`             | `{ sessionId: string, reason: string }` |
| `bbx-kyc-error`               | `KYC_ERROR`                | `{ message: string, code?: string }` |
| `bbx-kyc-step-changed`        | `KYC_STEP_CHANGED`         | `{ step: 'document' \| 'liveness' \| 'review' \| 'completed' }` |
| `bbx-kyc-document-uploaded`   | `KYC_DOCUMENT_UPLOADED`    | `{ documentType: string, side: string }` |
| `bbx-kyc-liveness-started`    | `KYC_LIVENESS_STARTED`     | `{}` |
| `bbx-kyc-liveness-passed`     | `KYC_LIVENESS_PASSED`      | `{}` |
| `bbx-kyc-liveness-failed`     | `KYC_LIVENESS_FAILED`      | `{ reason: string }` |

### Listening to events

```ts
const kyc = document.querySelector('bbx-kyc-flow');

kyc.addEventListener('bbx-kyc-started', (e) => {
  console.log('Flow started', e.detail);
});

kyc.addEventListener('bbx-kyc-completed', (e) => {
  console.log('KYC completed ✅', e.detail);
  // unlock features, redirect, etc.
});

kyc.addEventListener('bbx-kyc-rejected', (e) => {
  console.warn('KYC rejected ❌', e.detail.reason);
});

kyc.addEventListener('bbx-kyc-step-changed', (e) => {
  console.log('Step:', e.detail.step); // 'document' | 'liveness' | 'review'
});

kyc.addEventListener('bbx-kyc-error', (e) => {
  console.error('Error:', e.detail.message);
});
```

---

## Security & origin validation

### 1 — `allowed_origins` check (page embedding the component)

When the `token` attribute is set, the component decodes the JWT payload
(base64, without signature verification) and reads the `allowed_origins` array.
If `window.location.origin` is **not** in that array, the iframe is never rendered
and an error message is displayed.

```
JWT payload example:
{
  "allowed_origins": ["https://app.mycompany.com"],
  ...
}

Component on https://evil.com     → blocked ❌
Component on https://app.mycompany.com → allowed ✅
```

> **Note:** Signature verification only happens server-side. The client-side
> check is a UX safeguard and defense-in-depth measure; it is not the primary
> security control.

### 2 — `event.origin` check (postMessage)

Every `message` event is validated:
- `event.origin === new URL(kyc-url).origin` — only messages from the KYC app.
- `event.source === iframe.contentWindow` — handles multiple `<bbx-kyc-flow>`
  instances on the same page; each instance only processes its own iframe's messages.

---

## Sending events from the KYC flow app

Inside the `kyc-flow` application (`apps/kyc-flow`), send messages using:

```ts
function notifyParent(type: string, data: Record<string, unknown> = {}) {
  // targetOrigin should be the specific allowed origin, not '*'
  window.parent.postMessage({ type, data }, 'https://app.mycompany.com');
}

// Usage
notifyParent('KYC_STARTED',          { sessionId: 'abc-123' });
notifyParent('KYC_STEP_CHANGED',     { step: 'document' });
notifyParent('KYC_DOCUMENT_UPLOADED',{ documentType: 'passport', side: 'front' });
notifyParent('KYC_LIVENESS_STARTED', {});
notifyParent('KYC_LIVENESS_PASSED',  {});
notifyParent('KYC_COMPLETED',        { sessionId: 'abc-123', status: 'COMPLETED' });
// or on failure:
notifyParent('KYC_REJECTED',         { sessionId: 'abc-123', reason: 'FACE_MISMATCH' });
notifyParent('KYC_LIVENESS_FAILED',  { reason: 'NO_FACE_DETECTED' });
```

---

## Framework examples

### React

```tsx
import { useEffect, useRef } from 'react';
import 'bbx-kyc-flow';

export function KycVerification({ token }: { token: string }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onCompleted = (e: Event) =>
      console.log('Completed:', (e as CustomEvent).detail);
    const onRejected = (e: Event) =>
      console.warn('Rejected:', (e as CustomEvent).detail.reason);

    el.addEventListener('bbx-kyc-completed', onCompleted);
    el.addEventListener('bbx-kyc-rejected', onRejected);
    return () => {
      el.removeEventListener('bbx-kyc-completed', onCompleted);
      el.removeEventListener('bbx-kyc-rejected', onRejected);
    };
  }, []);

  return (
    <bbx-kyc-flow
      ref={ref}
      token={token}
      kyc-url="https://kyc.myapp.com"
      height="640px"
    />
  );
}
```

### Vue 3

```vue
<template>
  <bbx-kyc-flow
    :token="token"
    kyc-url="https://kyc.myapp.com"
    height="640px"
    @bbx-kyc-completed="onCompleted"
    @bbx-kyc-rejected="onRejected"
    @bbx-kyc-error="onError"
  />
</template>

<script setup lang="ts">
import 'bbx-kyc-flow';

defineProps<{ token: string }>();

const onCompleted = (e: CustomEvent) => console.log('Completed', e.detail);
const onRejected  = (e: CustomEvent) => console.warn('Rejected', e.detail.reason);
const onError     = (e: CustomEvent) => console.error('Error', e.detail.message);
</script>
```

### Vanilla HTML

```html
<script type="module" src="/bbx-kyc-flow.es.js"></script>

<bbx-kyc-flow id="kyc" token="eyJhbGci..." height="640px"></bbx-kyc-flow>

<script>
  const kyc = document.getElementById('kyc');

  kyc.addEventListener('bbx-kyc-completed', (e) => {
    alert('Verification complete! Session: ' + e.detail.sessionId);
  });

  kyc.addEventListener('bbx-kyc-rejected', (e) => {
    alert('Verification rejected: ' + e.detail.reason);
  });
</script>
```

---

## Slot

You can customize the placeholder shown when no token is set:

```html
<bbx-kyc-flow token="">
  <span slot="placeholder">Please wait while we prepare your verification…</span>
</bbx-kyc-flow>
```

---

## Development

```bash
# from packages/bbx-kyc-flow
pnpm dev      # Dev server with HMR at http://localhost:5173
pnpm build    # Production build → dist/
pnpm preview  # Preview the production build
```

---

## License

MIT — BlackyBox
