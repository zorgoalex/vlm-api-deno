import { Prompt, PromptCreate, PromptUpdate } from "./types.ts";
import { ulid } from "jsr:@std/ulid";

// We will open the KV store once and can reuse the instance.
const kv = await Deno.openKv();

/**
 * Creates a new prompt in the Deno KV store.
 *
 * @param data - The data for the new prompt.
 * @returns The fully created prompt object.
 * @throws Will throw an error if a prompt with the same name, namespace, and version already exists.
 */
export async function createPrompt(data: PromptCreate): Promise<Prompt> {
  const id = ulid(); // Generate a new unique, sortable ID
  const now = new Date().toISOString();

  const newPrompt: Prompt = {
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
  };

  // Define keys for the atomic transaction
  const promptKey = ["prompts", id];
  // A secondary index to quickly find a prompt by its natural key (name, ns, etc.)
  const promptByNameKey = ["prompts_by_name", data.namespace, data.name, data.version];

  const res = await kv.atomic()
    // Ensure a prompt with the same natural key doesn't already exist
    .check({ key: promptByNameKey, versionstamp: null })
    // Set the main prompt object
    .set(promptKey, newPrompt)
    // Set the secondary index to point to the main prompt's ID
    .set(promptByNameKey, id)
    .commit();

  if (!res.ok) {
    throw new Error("Failed to create prompt: A prompt with the same name, namespace, and version may already exist.");
  }

  return newPrompt;
}

/**
 * Retrieves a single prompt by its unique ID.
 *
 * @param id - The unique ID of the prompt.
 * @returns The prompt object or null if not found.
 */
export async function getPrompt(id: string): Promise<Prompt | null> {
  const key = ["prompts", id];
  const entry = await kv.get<Prompt>(key);
  return entry.value ?? null;
}

/**
 * Updates an existing prompt by its unique ID.
 *
 * @param id - The unique ID of the prompt to update.
 * @param data - The partial data to update the prompt with.
 * @returns The fully updated prompt object, or null if the prompt was not found.
 * @throws Will throw an error if the update fails (e.g., due to a conflicting change).
 */
export async function updatePrompt(id: string, data: PromptUpdate): Promise<Prompt | null> {
  const promptKey = ["prompts", id];

  // Start a transaction to read the existing prompt
  const getRes = await kv.get<Prompt>(promptKey);
  if (!getRes.value) {
    return null; // Prompt not found
  }

  const existingPrompt = getRes.value;

  // Merge old and new data
  const updatedPrompt: Prompt = {
    ...existingPrompt,
    ...data,
    id, // Ensure ID is not changed
    updatedAt: new Date().toISOString(),
  };

  const atomicOp = kv.atomic()
    // Check ensures that the prompt hasn't been modified since we read it
    .check(getRes)
    // Set the updated prompt object
    .set(promptKey, updatedPrompt);

  // If the natural key (name, namespace, version) has changed, we must update the secondary index
  const nameChanged = data.name !== undefined && data.name !== existingPrompt.name;
  const namespaceChanged = data.namespace !== undefined && data.namespace !== existingPrompt.namespace;
  const versionChanged = data.version !== undefined && data.version !== existingPrompt.version;

  if (nameChanged || namespaceChanged || versionChanged) {
    const oldByNameKey = ["prompts_by_name", existingPrompt.namespace, existingPrompt.name, existingPrompt.version];
    const newByNameKey = ["prompts_by_name", updatedPrompt.namespace, updatedPrompt.name, updatedPrompt.version];

    // Add deletion of the old index and creation of the new one to the transaction
    atomicOp
      .delete(oldByNameKey)
      .set(newByNameKey, id);
  }

  const res = await atomicOp.commit();

  if (!res.ok) {
    throw new Error("Failed to update prompt: The prompt was modified by another process.");
  }

  return updatedPrompt;
}
