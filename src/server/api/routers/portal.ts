import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, eidProcedure } from "@/server/api/trpc";
import { answerDeps } from "@/server/answers/deps";
import { logReason } from "@/server/answers/file";
import { submitAnswer } from "@/server/answers/submit";

// The outside portal's upload (docs/ARCHITECTURE.md, "Outside portal"). The answer page posts it as FormData.
export const answerForm = z
  .instanceof(FormData)
  .transform((data) => Object.fromEntries(data.entries()))
  .pipe(
    z.object({
      token: z.string().max(128),
      file: z.file(),
      patientName: z.string().trim().min(1, "Enter the patient's name").max(200),
      birthDate: z.iso.date("Enter the patient's birth date"),
    }),
  );

export const portalRouter = createTRPCRouter({
  answer: eidProcedure.input(answerForm).mutation(async ({ ctx, input }) => {
    try {
      return await submitAnswer(answerDeps, {
        token: input.token,
        session: ctx.actor.session,
        file: new Uint8Array(await input.file.arrayBuffer()),
        form: { name: input.patientName, birthDate: input.birthDate },
      });
    } catch (error) {
      // A database error's message carries the query's parameters: the document text and the raw ID token. Neither
      // goes to the browser or the log.
      console.error(`the answer to request ${ctx.actor.session.requestId} failed: ${logReason(error)}`);
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The answer could not be processed. Try again in a few minutes." });
    }
  }),
});
