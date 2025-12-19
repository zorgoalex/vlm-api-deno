import { Prompt, PromptCreate, PromptUpdate, PromptListFilters, PromptListResult, PromptCriteria } from "./types.ts";
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

  // Auto-sync default mapping if created as default
  if (newPrompt.isDefault === true) {
    await syncDefaultMapping(newPrompt.namespace, id);
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
export async function updatePrompt(
  id: string,
  data: PromptUpdate,
  opts?: { skipDefaultSync?: boolean }
): Promise<Prompt | null> {
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

  // After successful update, optionally sync default mapping
  if (data.isDefault === true && !opts?.skipDefaultSync) {
    await syncDefaultMapping(updatedPrompt.namespace, id);
  }

  return updatedPrompt;
}

/**
 * Deletes a prompt by its unique ID.
 * This operation is atomic and will also remove associated secondary indexes.
 *
 * @param id - The unique ID of the prompt to delete.
 * @returns {Promise<boolean>} True if the prompt was found and deleted, false otherwise.
 */
export async function deletePrompt(id: string): Promise<boolean> {
  const promptKey = ["prompts", id];

  // We need to read the prompt first to get details for deleting the secondary index
  const prompt = await getPrompt(id);
  if (!prompt) {
    return false; // Prompt not found
  }

  const byNameKey = ["prompts_by_name", prompt.namespace, prompt.name, prompt.version];

  const res = await kv.atomic()
    .delete(promptKey)
    .delete(byNameKey)
    .commit();

  return res.ok;
}

/**
 * Lists prompts with optional filtering, sorting and pagination.
 * Uses secondary index by namespace when possible, otherwise scans main prefix.
 */
export async function listPrompts(filters: PromptListFilters = {}): Promise<PromptListResult> {
  const {
    namespace,
    name,
    isActive,
    tag,
    limit = 50,
    cursor,
    sortBy = "updatedAt",
    sortOrder = "desc",
  } = filters;

  const items: Prompt[] = [];

  // Helper to push if matches remaining filters
  const matches = (p: Prompt) => {
    if (name && p.name !== name) return false;
    if (typeof isActive === "boolean" && p.isActive !== isActive) return false;
    if (tag && (!p.tags || !p.tags.includes(tag))) return false;
    return true;
  };

  let nextCursor: string | undefined = undefined;

  // Prefer index by namespace when provided (fast path)
  if (namespace && !name) {
    const iter = kv.list<string>({ prefix: ["prompts_by_name", namespace] }, { limit, cursor });
    for await (const entry of iter) {
      const promptId = entry.value;
      const p = await getPrompt(promptId);
      if (p && matches(p)) {
        items.push(p);
      }
      if (items.length >= limit) break;
    }
    // @ts-ignore cursor is available on iterator in Deno KV
    nextCursor = (iter as any).cursor as string | undefined;
  } else {
    // Fallback: scan main prefix
    const iter = kv.list<Prompt>({ prefix: ["prompts"] }, { limit: limit * 2, cursor });
    for await (const entry of iter) {
      const p = entry.value;
      if (!p) continue;
      if (namespace && p.namespace !== namespace) continue;
      if (!matches(p)) continue;
      items.push(p);
      if (items.length >= limit) break;
    }
    // @ts-ignore cursor is available on iterator in Deno KV
    nextCursor = (iter as any).cursor as string | undefined;
  }

  // Sorting in-memory according to requested criteria
  const dir = sortOrder === "asc" ? 1 : -1;
  items.sort((a, b) => {
    let av: number | string = 0;
    let bv: number | string = 0;
    if (sortBy === "priority") {
      av = a.priority; bv = b.priority;
    } else if (sortBy === "createdAt") {
      av = a.createdAt; bv = b.createdAt;
    } else {
      av = a.updatedAt; bv = b.updatedAt;
    }
    // ISO dates compare lexicographically
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });

  return { items, cursor: nextCursor };
}

/**
 * Finds the best matching prompt using optional criteria.
 * Priority is resolved by higher priority, then higher version, then newer updatedAt.
 */
export async function findPromptByCriteria(criteria: PromptCriteria): Promise<Prompt | null> {
  const desiredVersion = Number.isFinite(criteria.version) ? criteria.version : undefined;
  const desiredPriority = Number.isFinite(criteria.priority) ? criteria.priority : undefined;

  const hasCriteria = Boolean(
    criteria.namespace ||
    criteria.name ||
    desiredVersion !== undefined ||
    criteria.lang ||
    (criteria.tags && criteria.tags.length > 0) ||
    desiredPriority !== undefined
  );
  if (!hasCriteria) return null;

  const matches = (p: Prompt) => {
    if (criteria.namespace && p.namespace !== criteria.namespace) return false;
    if (criteria.name && p.name !== criteria.name) return false;
    if (desiredVersion !== undefined && p.version !== desiredVersion) return false;
    if (criteria.lang && p.lang !== criteria.lang) return false;
    if (criteria.tags && criteria.tags.length > 0) {
      if (!p.tags || criteria.tags.some((tag) => !p.tags.includes(tag))) return false;
    }
    if (desiredPriority !== undefined && p.priority !== desiredPriority) return false;
    return true;
  };

  const isBetter = (candidate: Prompt, current: Prompt) => {
    if (candidate.priority !== current.priority) return candidate.priority > current.priority;
    if (candidate.version !== current.version) return candidate.version > current.version;
    return candidate.updatedAt > current.updatedAt;
  };

  // Fast path: exact natural key
  if (criteria.namespace && criteria.name && desiredVersion !== undefined) {
    const key = ["prompts_by_name", criteria.namespace, criteria.name, desiredVersion];
    const mapping = await kv.get<string>(key);
    if (!mapping.value) return null;
    const prompt = await getPrompt(mapping.value);
    return prompt && matches(prompt) ? prompt : null;
  }

  let best: Prompt | null = null;

  if (criteria.namespace && criteria.name) {
    const iter = kv.list<string>({ prefix: ["prompts_by_name", criteria.namespace, criteria.name] });
    for await (const entry of iter) {
      const promptId = entry.value;
      const p = await getPrompt(promptId);
      if (!p || !matches(p)) continue;
      if (!best || isBetter(p, best)) best = p;
    }
    return best;
  }

  if (criteria.namespace) {
    const iter = kv.list<string>({ prefix: ["prompts_by_name", criteria.namespace] });
    for await (const entry of iter) {
      const promptId = entry.value;
      const p = await getPrompt(promptId);
      if (!p || !matches(p)) continue;
      if (!best || isBetter(p, best)) best = p;
    }
    return best;
  }

  const iter = kv.list<Prompt>({ prefix: ["prompts"] });
  for await (const entry of iter) {
    const p = entry.value;
    if (!p || !matches(p)) continue;
    if (!best || isBetter(p, best)) best = p;
  }
  return best;
}

/**
 * Finds a default prompt for Vision requests when no inline prompt is provided.
 * Criteria: namespace=default, priority=1, isDefault=true, isActive=true.
 * Selects the highest version, then most recently updated.
 */
export async function findDefaultVisionPrompt(): Promise<Prompt | null> {
  let best: Prompt | null = null;
  const iter = kv.list<Prompt>({ prefix: ["prompts"] });
  for await (const entry of iter) {
    const p = entry.value;
    if (!p) continue;
    if (p.namespace !== "default") continue;
    if (p.priority !== 1) continue;
    if (!p.isDefault) continue;
    if (!p.isActive) continue;
    if (!best) {
      best = p;
      continue;
    }
    if (p.version !== best.version) {
      if (p.version > best.version) best = p;
      continue;
    }
    if (p.updatedAt > best.updatedAt) best = p;
  }
  return best;
}

/**
 * Gets the default prompt for a namespace (if provided) or globally (first found).
 */
export async function getDefaultPrompt(namespace?: string): Promise<Prompt | null> {
  if (namespace) {
    const mappingKey = ["prompts_default", namespace];
    const mapping = await kv.get<string>(mappingKey);
    if (mapping.value) {
      const p = await getPrompt(mapping.value);
      if (p) return p;
    }
    return null;
  }

  // Fallback: scan for any isDefault=true
  const iter = kv.list<Prompt>({ prefix: ["prompts"] }, { limit: 200 });
  for await (const entry of iter) {
    const p = entry.value;
    if (p?.isDefault) return p;
  }
  return null;
}

/**
 * Sets the default prompt for a namespace. If namespace is not provided, uses prompt.namespace.
 * Ensures previous default (if any) is unset.
 */
export async function setDefaultPrompt(id: string, namespace?: string): Promise<Prompt | null> {
  const current = await getPrompt(id);
  if (!current) return null;

  const ns = namespace || current.namespace;
  const mappingKey = ["prompts_default", ns];

  // Find previous default
  const mapping = await kv.get<string>(mappingKey);
  const prevId = mapping.value;

  // If previous is different, unset it
  if (prevId && prevId !== id) {
    const prev = await getPrompt(prevId);
    if (prev && prev.isDefault) {
      await updatePrompt(prevId, { isDefault: false }, { skipDefaultSync: true });
    }
  }

  // Set current as default and update mapping
  await updatePrompt(id, { isDefault: true }, { skipDefaultSync: true });
  await kv.set(mappingKey, id);

  return await getPrompt(id);
}

/**
 * Ensures mapping prompts_default:{namespace} points to provided id and there is no other default in this namespace.
 */
async function syncDefaultMapping(namespace: string, id: string): Promise<void> {
  const mappingKey = ["prompts_default", namespace];
  const mapping = await kv.get<string>(mappingKey);
  const prevId = mapping.value;

  if (prevId && prevId !== id) {
    const prev = await getPrompt(prevId);
    if (prev?.isDefault) {
      await updatePrompt(prevId, { isDefault: false }, { skipDefaultSync: true });
    }
  }
  await kv.set(mappingKey, id);
}

/**
 * Synchronize default mapping for a specific namespace based on current prompts state.
 * Picks the best candidate among prompts with isDefault=true (by priority desc, updatedAt desc).
 * Ensures only one default remains in the namespace and updates mapping accordingly.
 */
export async function syncDefaultForNamespace(namespace: string): Promise<{ namespace: string; id?: string; unset: string[] }> {
  const candidates: Prompt[] = [];
  const othersToUnset: string[] = [];

  const iter = kv.list<Prompt>({ prefix: ["prompts"] });
  for await (const entry of iter) {
    const p = entry.value;
    if (!p) continue;
    if (p.namespace !== namespace) continue;
    if (p.isDefault) candidates.push(p);
  }

  // Select best candidate if any
  let selected: Prompt | undefined;
  if (candidates.length > 0) {
    candidates.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority; // higher first
      return a.updatedAt < b.updatedAt ? 1 : (a.updatedAt > b.updatedAt ? -1 : 0); // newer first
    });
    selected = candidates[0];
    for (const p of candidates.slice(1)) {
      othersToUnset.push(p.id);
    }
  }

  const mappingKey = ["prompts_default", namespace];

  if (selected) {
    // Unset others
    for (const id of othersToUnset) {
      await updatePrompt(id, { isDefault: false }, { skipDefaultSync: true });
    }
    // Set mapping to selected
    await kv.set(mappingKey, selected.id);
    return { namespace, id: selected.id, unset: othersToUnset };
  } else {
    // No candidate; remove mapping if exists
    await kv.delete(mappingKey);
    return { namespace, unset: [] };
  }
}

/**
 * Synchronize default mappings for all namespaces found in prompts.
 */
export async function syncDefaultMappingsAll(): Promise<Array<{ namespace: string; id?: string; unset: string[] }>> {
  const namespaces = new Set<string>();
  const iter = kv.list<Prompt>({ prefix: ["prompts"] });
  for await (const entry of iter) {
    const p = entry.value;
    if (p) namespaces.add(p.namespace);
  }
  const results: Array<{ namespace: string; id?: string; unset: string[] }> = [];
  for (const ns of namespaces) {
    results.push(await syncDefaultForNamespace(ns));
  }
  return results;
}
