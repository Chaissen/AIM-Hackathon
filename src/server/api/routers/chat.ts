import { z } from "zod";

import { roomReference } from "@/lib/workspace";
import { createTRPCRouter, workspaceProcedure } from "@/server/api/trpc";
import { sendWorkspaceMessage, workspaceMatrixError, workspaceRooms, workspaceTimeline } from "@/server/matrix/workspace";

export const chatRouter = createTRPCRouter({
  rooms: workspaceProcedure.query(({ ctx }) => workspaceRooms(ctx.matrix).catch(workspaceMatrixError)),
  timeline: workspaceProcedure
    .input(z.object({ room: roomReference, cursor: z.string().min(1).max(2048).optional() }))
    .query(({ ctx, input }) => workspaceTimeline(ctx.matrix, input.room, input.cursor).catch(workspaceMatrixError)),
  send: workspaceProcedure
    .input(z.object({ room: roomReference, body: z.string().trim().min(1).max(4000), transactionId: z.uuid() }))
    .mutation(({ ctx, input }) => sendWorkspaceMessage(ctx.matrix, input).catch(workspaceMatrixError)),
});
