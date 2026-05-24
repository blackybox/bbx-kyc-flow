import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { createRef, ref } from 'lit/directives/ref.js';
import { initialize } from '@open-iframe-resizer/core';

// ─── Event name constants ────────────────────────────────────────────────────

export const KYC_EVENTS = {
  started: 'started',
  completed: 'completed',
  rejected: 'rejected',
  error: 'error',
  document_verified: 'document_verified',
  biometric_verified: 'biometric_verified',
} as const;

export type KycEventName = typeof KYC_EVENTS[keyof typeof KYC_EVENTS];

// ─── postMessage type → CustomEvent name map ─────────────────────────────────

// const MESSAGE_EVENT_MAP: Record<string, string> = {
//   KYC_STARTED: KYC_EVENTS.STARTED,
//   KYC_COMPLETED: KYC_EVENTS.COMPLETED,
//   KYC_REJECTED: KYC_EVENTS.REJECTED,
//   KYC_ERROR: KYC_EVENTS.ERROR,
//   KYC_DOCUMENT_VERIFIED: KYC_EVENTS.DOCUMENT_VERIFIED,
//   KYC_BIOMETRIC_VERIFIED: KYC_EVENTS.BIOMETRIC_VERIFIED,
// };

// ─── Types ───────────────────────────────────────────────────────────────────

type ComponentStatus = 'idle' | 'ready' | 'error' | 'invalid-origin';

interface JwtPayload {
  session_id?: string;
  merchant_id?: string;
  allowed_origins?: string[];
  permissions?: string[];
  exp?: number;
  iat?: number;
  jti?: string;
}

// ─── Web Component ───────────────────────────────────────────────────────────

/**
 * `bbx-kyc-flow`
 *
 * Embeds the BlackyBox KYC verification flow inside an iframe and bridges
 * `window.postMessage` events from the iframe to standard DOM CustomEvents.
 *
 * The component decodes the session JWT to extract `allowed_origins` and
 * validates that the current page origin is authorized before rendering.
 *
 * @attr {string} token    - Session JWT returned by the KYC Sessions API.
 * @attr {string} kyc-url  - Base URL of the KYC flow app. Default: http://localhost:5174
 * @attr {string} width    - CSS width of the iframe. Default: 100%
 * @attr {string} height   - CSS height of the iframe. Default: 600px
 *
 * @fires {CustomEvent} started            - KYC flow has started
 * @fires {CustomEvent} completed           - KYC flow completed successfully
 * @fires {CustomEvent} rejected            - KYC was rejected
 * @fires {CustomEvent} error               - An error occurred
 * @fires {CustomEvent} document_verified   - Document was verified
 * @fires {CustomEvent} biometric_verified  - Biometric check was verified
 */
@customElement('bbx-kyc-flow')
export class BbxKycFlow extends LitElement {

  // ── Public properties ──────────────────────────────────────────────────────

  @property({ type: String })
  token = '';

  @property({ type: String, attribute: 'kyc-url' })
  kycUrl = 'http://localhost:5174';

  @property({ type: String })
  width = '100%';

  @property({ type: String })
  height = '600px';

  // ── Internal state ─────────────────────────────────────────────────────────

  @state() private _status: ComponentStatus = 'idle';
  @state() private _errorMessage = '';
  @state() private _iframeLoaded = false;

  private _allowedOrigins: string[] = [];
  private _iframeRef = createRef<HTMLIFrameElement>();
  // private readonly _boundMessageHandler = this._handleMessage.bind(this);
  private _iframeResizerCleanup: (() => void) | undefined;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('message', this._handleMessage);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('message', this._handleMessage);
    this._iframeResizerCleanup?.();
  }

  override updated(changedProps: Map<string, unknown>): void {
    if (changedProps.has('token') && this.token) {
      this._iframeLoaded = false;
      this._initFromToken();
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Reloads the embedded KYC iframe. */
  reload(): void {
    const iframe = this._iframeRef.value;
    if (iframe) {
      iframe.src = this._iframeSrc;
      this._iframeLoaded = false;
    }
  }

  // ── Private methods ────────────────────────────────────────────────────────

  private _initFromToken(): void {
    const payload = this._decodeJwtPayload(this.token);

    if (!payload) {
      this._status = 'error';
      this._errorMessage = 'Invalid session token.';
      return;
    }

    if (payload.exp !== undefined && payload.exp * 1000 < Date.now()) {
      this._status = 'error';
      this._errorMessage = 'Session token has expired.';
      return;
    }

    this._allowedOrigins = payload.allowed_origins ?? [];

    if (this._allowedOrigins.length > 0 && !this._isCurrentOriginAllowed()) {
      this._status = 'invalid-origin';
      this._errorMessage =
        `This component is not authorized to run on origin "${window.location.origin}". ` +
        `Allowed: ${this._allowedOrigins.join(', ')}`;
      console.warn('[bbx-kyc-flow] Origin validation failed:', {
        current: window.location.origin,
        allowed: this._allowedOrigins,
      });
      return;
    }

    this._status = 'ready';
  }

  /** Decodes a JWT payload without verifying the signature (client-side only). */
  private _decodeJwtPayload(token: string): JwtPayload | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      // Base64url → Base64 → JSON
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
          .join(''),
      );
      return JSON.parse(json) as JwtPayload;
    } catch {
      return null;
    }
  }

  private _isCurrentOriginAllowed(): boolean {
    return this._allowedOrigins.some((o) => o === window.location.origin);
  }

  private _getIframeOrigin(): string {
    try {
      return new URL(this.kycUrl).origin;
    } catch {
      return '';
    }
  }

  private _handleMessage = (event: MessageEvent): void => {    
    const iframeOrigin = this._getIframeOrigin();

    // Only accept messages from the KYC iframe origin
    if (iframeOrigin && event.origin !== iframeOrigin) return;

    // Ensure the message came specifically from THIS component's iframe
    // (handles multiple bbx-kyc-flow instances on the same page)
    if (
      this._iframeRef.value &&
      event.source !== this._iframeRef.value.contentWindow
    ) return;

    // Validate message structure
    if (!event.data || typeof event.data !== 'object') return;

    const msg = event.data as { type?: unknown; data?: unknown };
    if (typeof msg.type !== 'string') return;

    const eventName = KYC_EVENTS[msg.type as keyof typeof KYC_EVENTS];
    if (!eventName) return;

    const detail =
      msg.data !== null && typeof msg.data === 'object'
        ? (msg.data as Record<string, unknown>)
        : {};

    this._dispatchKycEvent(eventName, detail);
  }

  private _dispatchKycEvent(
    name: string,
    detail: Record<string, unknown> = {},
  ): void {
    this.dispatchEvent(
      new CustomEvent(name, {
        bubbles: true,
        composed: true,
        detail,
      }),
    );
  }

  private get _iframeSrc(): string {
    const base = this.kycUrl.replace(/\/$/, '');
    return `${base}/verify/?token=${encodeURIComponent(this.token)}`;
  }

  private _onIframeLoad(): void {
    this._iframeLoaded = true;
    this._iframeResizerCleanup?.();
    const iframe = this._iframeRef.value;
    if (iframe) {
      this._iframeResizerCleanup = initialize({}, iframe);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  override render() {
    if (!this.token || this._status === 'idle') {
      return html`
        <div class="state-message state-info">
          <slot name="placeholder">
            <span>No session token provided.</span>
          </slot>
        </div>
      `;
    }

    if (this._status === 'error' || this._status === 'invalid-origin') {
      return html`
        <div class="state-message state-error" role="alert">
          ${this._iconWarning()}
          <span>${this._errorMessage}</span>
        </div>
      `;
    }

    return html`
      <div class="iframe-wrapper">
        ${this._iframeLoaded
          ? nothing
          : html`<div class="loader" aria-label="Loading KYC flow…">
              <div class="spinner"></div>
            </div>`}
        <iframe
          ${ref(this._iframeRef)}
          class="kyc-iframe ${this._iframeLoaded ? 'loaded' : ''}"
          src=${this._iframeSrc}
          style="width: ${this.width};"
          allow="camera; microphone"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          title="KYC Verification Flow"
          @load=${this._onIframeLoad}
        ></iframe>
      </div>
    `;
  }

  private _iconWarning() {
    return html`
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    `;
  }

  // ── Styles ─────────────────────────────────────────────────────────────────

  static override styles = css`
    :host {
      display: block;
      width: 100%;
      font-family: sans-serif;
    }

    .iframe-wrapper {
      position: relative;
      width: 100%;
    }

    .kyc-iframe {
      display: block;
      border: none;
      border-radius: 8px;
      opacity: 0;
      transition: opacity 0.3s ease;
    }

    .kyc-iframe.loaded {
      opacity: 1;
    }

    .loader {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f8f9fa;
      border-radius: 8px;
    }

    .spinner {
      width: 36px;
      height: 36px;
      border: 3px solid #e0e0e0;
      border-top-color: #2563eb;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    .state-message {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 16px;
      border-radius: 8px;
      font-size: 14px;
    }

    .state-info {
      background-color: #f0f4ff;
      color: #555;
    }

    .state-error {
      background-color: #fff0f0;
      color: #c0392b;
      border: 1px solid #f5c6c6;
    }
  `;
}

// ─── Global type augmentation ────────────────────────────────────────────────

declare global {
  interface HTMLElementTagNameMap {
    'bbx-kyc-flow': BbxKycFlow;
  }
}
