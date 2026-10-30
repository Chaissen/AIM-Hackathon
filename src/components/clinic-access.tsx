"use client";

import type { WidgetApi } from "matrix-widget-api";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { TRPCReactProvider } from "@/trpc/react";

/** UI sign-in only; every data query independently verifies the token with Synapse. */
export function ClinicAccess({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let api: WidgetApi | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const fail = (message: string) => {
      if (!disposed) {
        setToken(null);
        setError(message);
      }
    };
    const timeout = setTimeout(() => fail("Element did not confirm your identity. Reload the widget to try again."), 60_000);

    async function connect() {
      if (window.parent === window) {
        clearTimeout(timeout);
        fail("Open the ordy widget in Element to view patient information and the audit log.");
        return;
      }
      const { WidgetApi } = await import("matrix-widget-api");
      if (disposed) return;
      const params = new URLSearchParams(window.location.search);
      // Element sets `no-referrer`, so its origin comes from the `parentUrl` it appends to the widget URL. A null origin
      // would make postMessage target the widget's own origin, and Element would never see the widget.
      const parent = URL.parse(params.get("parentUrl") || document.referrer);
      if (!parent) {
        clearTimeout(timeout);
        fail("Open the ordy widget in Element to view patient information and the audit log.");
        return;
      }
      api = new WidgetApi(params.get("widgetId"), parent.origin);
      api.once("ready", () => {
        void api!.requestOpenIDConnectToken().then((credentials) => {
          if (disposed) return;
          clearTimeout(timeout);
          const seconds = credentials.expires_in;
          if (!credentials.access_token || !seconds || !Number.isFinite(seconds) || seconds <= 0) {
            fail("Element did not provide a valid sign-in. Reload the widget to try again.");
            return;
          }
          setError(null);
          setToken(credentials.access_token);
          expiry = setTimeout(() => fail("Your sign-in has expired. Reload the widget to continue."), Math.min(seconds, 3600) * 1000);
        }).catch(() => {
          clearTimeout(timeout);
          fail("Identity verification was declined or failed. Reload the widget to try again.");
        });
      });
      api.start();
      await api.sendContentLoaded();
    }
    void connect().catch(() => {
      clearTimeout(timeout);
      fail("Could not connect to Element. Reload the widget to try again.");
    });
    return () => {
      disposed = true;
      clearTimeout(timeout);
      clearTimeout(expiry);
      api?.removeAllListeners();
      api?.transport.stop();
    };
  }, []);

  if (error) return <div className="grid gap-3"><p role="alert">{error}</p><Button onClick={() => window.location.reload()}>Reload</Button></div>;
  if (!token) return <p>Confirm your identity in Element to continue …</p>;
  return <TRPCReactProvider key={token} clinicToken={token}>{children}</TRPCReactProvider>;
}
