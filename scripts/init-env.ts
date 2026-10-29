import { setupEnv } from "../src/server/auth/setup-env";

await setupEnv(".env", ".env.example");
console.log("Local environment ready; session key is private.");
