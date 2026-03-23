import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';

declare global {
  interface Window {
    turnstile: any;
    onloadTurnstileCallback: () => void;
  }
}

interface TurnstileProps {
  siteKey: string;
  onSuccess: (token: string) => void;
  onError?: () => void;
  onExpire?: () => void;
}

export interface TurnstileHandle {
  reset: () => void;
}

const Turnstile = forwardRef<TurnstileHandle, TurnstileProps>(
  ({ siteKey, onSuccess, onError, onExpire }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const callbacksRef = useRef({ onSuccess, onError, onExpire });

    useEffect(() => {
      callbacksRef.current = { onSuccess, onError, onExpire };
    });

    useImperativeHandle(ref, () => ({
      reset: () => {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
        }
      }
    }));

    useEffect(() => {
      const scriptId = 'cloudflare-turnstile-script';
      let script = document.getElementById(scriptId) as HTMLScriptElement;

      const renderWidget = () => {
        if (window.turnstile && containerRef.current && !widgetIdRef.current) {
          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: siteKey,
            callback: (token: string) => callbacksRef.current.onSuccess(token),
            'error-callback': () => callbacksRef.current.onError && callbacksRef.current.onError(),
            'expired-callback': () => callbacksRef.current.onExpire && callbacksRef.current.onExpire(),
            theme: 'dark'
          });
        }
      };

      if (!script) {
        script = document.createElement('script');
        script.id = scriptId;
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onloadTurnstileCallback';
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);

        window.onloadTurnstileCallback = () => {
          renderWidget();
        };
      } else if (window.turnstile) {
        renderWidget();
      }

      return () => {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        }
      };
    }, [siteKey]);

    return <div ref={containerRef} />;
  }
);

Turnstile.displayName = 'Turnstile';

export default Turnstile;
