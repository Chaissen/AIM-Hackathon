import type { EidSession } from "@/server/auth/eid-session";
import { db } from "@/server/db";
import { findRequestByToken } from "@/server/requests/service";
import { type AnswerContext, findAnswerContext } from "./data";

/**
 * What GET /r/{token}/answer shows. Only `answer` carries the patient and the document type.
 * - `login`: no session for this link yet, so back to the landing page and its login button.
 * - `held`: the request waits for Dr. Hofer. `filed`: the answer is filed, thank you.
 * - `closed`: "This link does not work", also for a session of someone the request is not bound to.
 */
export type AnswerPage =
  | { page: "login" }
  | { page: "answer"; context: AnswerContext }
  | { page: "held" }
  | { page: "filed" }
  | { page: "closed" };

export async function loadAnswerPage(token: string, session: EidSession | null): Promise<AnswerPage> {
  if (!session) return { page: "login" };
  const request = await findRequestByToken(db, token);
  if (!request) return { page: "closed" };
  // A session from another link in the same browser: log in for this one.
  if (request.id !== session.requestId) return { page: "login" };
  if (!request.personNumber || request.personNumber !== session.personNumber) return { page: "closed" };
  switch (request.state) {
    case "verified": {
      const context = await findAnswerContext(token, session);
      return context ? { page: "answer", context } : { page: "closed" };
    }
    case "identity_held":
    case "answer_held":
      return { page: "held" };
    case "filed":
      return { page: "filed" };
    default:
      return { page: "closed" };
  }
}
