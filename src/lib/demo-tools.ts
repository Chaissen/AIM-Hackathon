/** The demo helpers (the inbox card, "Try it yourself", /inbox, and /sms) exist only outside a production build. */
export const demoToolsEnabled = process.env.NODE_ENV !== "production";
