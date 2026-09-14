// Client-safe: the schema is a plain zod object — no SDK, no key, no prompt
// text. The browser imports only the inferred TYPE (erased at compile time);
// the server imports the schema VALUE.
import { z } from "zod";

// `.describe()` is not decoration. Descriptions are sent to the model as part
// of the schema, so they act as per-field instructions.
export const ConversationAnalysisSchema = z.object({
  title: z
    .string()
    .describe("A short title for this conversation, 2 to 5 words, no punctuation"),
  topics: z
    .array(z.string())
    .describe("Up to 4 technical topics discussed, each 1-3 words"),
  open_questions: z
    .array(z.string())
    .describe("Questions the user asked that were not fully answered"),
});

export type ConversationAnalysis = z.infer<typeof ConversationAnalysisSchema>;
