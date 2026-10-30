import { type Operation, type TRPCLink, TRPCClientError } from "@trpc/client";
import { type inferRouterInputs, type inferRouterOutputs, TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { observable } from "@trpc/server/observable";
import { TRPC_ERROR_CODES_BY_KEY } from "@trpc/server/rpc";

import type { AppRouter } from "@/server/api/root";

type Inputs = inferRouterInputs<AppRouter>;
type Outputs = inferRouterOutputs<AppRouter>;

/** The routers the widget calls. Every procedure of them needs a fixture, so a new procedure fails typecheck until it has one. */
type WidgetRouter = "clinic" | "directory" | "document" | "metrics" | "request";

/** Answers like the procedure, from memory. A fixture throws a TRPCError where the procedure would. */
export type RouterFixtures<R extends WidgetRouter> = { [P in keyof Outputs[R]]: (input: Inputs[R][P]) => Outputs[R][P] };
export type Fixtures = { [R in WidgetRouter]: RouterFixtures<R> };

type AnyFixture = (input: never) => unknown;

const isWidgetRouter = (fixtures: Fixtures, router: string): router is WidgetRouter => Object.hasOwn(fixtures, router);

function find(fixtures: Fixtures, path: string): AnyFixture | undefined {
  const [router, procedure, ...rest] = path.split(".");
  if (rest.length > 0 || procedure === undefined || !isWidgetRouter(fixtures, router)) return undefined;
  const procedures: Readonly<Record<string, AnyFixture>> = fixtures[router];
  return Object.hasOwn(procedures, procedure) ? procedures[procedure] : undefined;
}

function clientError(cause: unknown, path: string) {
  const error =
    cause instanceof TRPCError
      ? cause
      : new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: cause instanceof Error ? cause.message : String(cause), cause });
  return TRPCClientError.from<AppRouter>({
    error: {
      code: TRPC_ERROR_CODES_BY_KEY[error.code],
      message: error.message,
      data: { code: error.code, httpStatus: getHTTPStatusCodeFromError(error), path, zodError: null },
    },
  });
}

/** A terminating link: every call gets `answer(op)` after `delayMs`, so loading states show, or the error it throws. */
function answerLink(answer: (op: Operation) => unknown, delayMs: number): TRPCLink<AppRouter> {
  return () =>
    ({ op }) =>
      observable((observer) => {
        const timer = setTimeout(() => {
          try {
            observer.next({ result: { type: "data", data: answer(op) } });
            observer.complete();
          } catch (cause) {
            observer.error(clientError(cause, op.path));
          }
        }, delayMs);
        return () => clearTimeout(timer);
      });
}

export const fixtureLink = (fixtures: Fixtures, delayMs: number) =>
  answerLink((op) => {
    const fixture = find(fixtures, op.path);
    if (!fixture) throw new Error(`No fixture for ${op.path}`);
    // The typed client checked the input against the procedure; the link sees it as unknown.
    return fixture(op.input as never);
  }, delayMs);

export const failingLink = (delayMs: number) =>
  answerLink(() => {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The fixture set failing answers every call with an error." });
  }, delayMs);
