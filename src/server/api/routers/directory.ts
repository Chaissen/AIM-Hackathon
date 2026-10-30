import { z } from "zod";

import { clinicProcedure, createTRPCRouter } from "@/server/api/trpc";
import { listDirectory } from "@/server/ehvd/listing";
import { searchDirectory } from "@/server/ehvd/search";

export const directoryRouter = createTRPCRouter({
  /** The entries of EHVD_DIRECTORY_OIDS, which the Contacts view shows before any search. */
  listed: clinicProcedure.query(() => listDirectory()),
  search: clinicProcedure.input(z.object({ name: z.string().trim().min(2).max(60) })).query(({ input }) => searchDirectory(input.name)),
});
