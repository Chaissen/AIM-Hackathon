import { z } from "zod";

import { clinicProcedure, createTRPCRouter } from "@/server/api/trpc";
import { searchDirectory } from "@/server/ehvd/search";

export const directoryRouter = createTRPCRouter({
  search: clinicProcedure.input(z.object({ name: z.string().trim().min(2).max(60) })).query(({ input }) => searchDirectory(input.name)),
});
