import { z } from "zod";

import { createTRPCRouter, eidProcedure } from "@/server/api/trpc";
import { answerDeps } from "@/server/answers/deps";
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
  answer: eidProcedure.input(answerForm).mutation(async ({ ctx, input }) =>
    submitAnswer(answerDeps, {
      token: input.token,
      session: ctx.actor.session,
      file: new Uint8Array(await input.file.arrayBuffer()),
      form: { name: input.patientName, birthDate: input.birthDate },
    }),
  ),
});
