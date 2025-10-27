/**
 * Data types for the Prompts subsystem based on Deno KV.
 */

/**
 * The main Prompt entity stored in the database.
 */
export interface Prompt {
  id: string; // ULID or similar unique identifier
  namespace: string;
  name: string;
  version: number;
  lang: string;
  text: string;
  tags: string[];
  priority: number;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string; // ISO 8601 format
  updatedAt: string; // ISO 8601 format
}

/**
 * Data required to create a new prompt.
 * Omits database-generated fields like id, createdAt, updatedAt.
 */
export type PromptCreate = Omit<Prompt, "id" | "createdAt" | "updatedAt">;

/**
 * Data structure for updating an existing prompt.
 * All fields are optional.
 */
export type PromptUpdate = Partial<Omit<Prompt, "id" | "createdAt" | "updatedAt">>;
