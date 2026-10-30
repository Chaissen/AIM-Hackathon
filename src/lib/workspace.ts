import { z } from "zod";

export const WORKSPACE_HEADER = "x-ordy-workspace";

export const roomReference = z.string().min(2).max(512).refine((value) => {
  const separator = value.indexOf(":");
  const shape = value.startsWith("!")
    ? value.length > 1 && (separator === -1 || separator > 1 && separator < value.length - 1)
    : value.startsWith("#") && separator > 1 && separator < value.length - 1;
  return shape && [...value].every((character) => character.trim() !== "");
}, "Choose a Matrix room ID or alias");

export const workspaceSessionResponse = z.discriminatedUnion("status", [
  z.object({ status: z.literal("signed_out"), clinic: z.string() }),
  z.object({
    status: z.literal("signed_in"),
    user: z.object({ mxid: z.string(), displayName: z.string(), clinic: z.string() }),
    expiresAt: z.iso.datetime(),
  }),
]);

export type WorkspaceSessionResponse = z.infer<typeof workspaceSessionResponse>;
