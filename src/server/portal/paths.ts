import type { LoginPage } from "@/server/identity/login";

// Where the login callback (T07) sends the person for each result of runIdentityChecks (T08). Only `answer` shows the
// patient and the document type; the others say nothing about them.
const SUFFIX: Record<LoginPage, string> = {
  answer: "/answer",
  held: "/held",
  wrong_person: "/refused",
  unavailable: "/unavailable",
  // The landing page shows "This link does not work" for a link that no longer works.
  closed: "",
};

export const portalPath = (token: string, page: LoginPage) => `/r/${encodeURIComponent(token)}${SUFFIX[page]}`;
